import {
  db,
  conversationsTable,
  auditLogsTable,
  aiAutoRepliesTable,
  type ClassroomFact,
  type Tenant,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { postChatwootMessage } from "./chatwoot";
import { studentWhisper, studentFlashDraft } from "@workspace/ai-student";
import {
  triageInbound,
  resolveRouteBranch,
  routerConfigured,
  type RouterDecision,
} from "@workspace/ai-router";
import {
  retrieveClassroomFactsWithMatch,
  classifyQueryCategory,
  normalizeCategory,
  hasUnresolvedConflicts,
  retrieveLibraryContext,
  professorEscalate,
  persistEscalatedFacts,
  type FactCategory,
  type ProfessorEscalation,
  type ClassroomMatchType,
} from "./knowledge";
import {
  resolveEffectiveEngagementMode,
  evaluateAutoSend,
  evaluateProfessorEscalationSend,
  evaluateAutoPilotTurn,
  describeHandbackReason,
} from "./engagementPolicy";
import {
  recordAutopilotTurnEvent,
  getAutopilotFallbackCounts,
} from "./autopilotTurnEventStore";
import {
  upsertConversationAiState,
  supersedeConversationAiState,
  finalizeCopilotDraftForInbound,
  stageCopilotDraftForInbound,
  getConversationAiState,
  type AiDraftSource,
} from "./aiStateStore";
import { professorConfigured } from "./grokClient";
import { sendConversationReply } from "./outboundReply";
import { checkOutboundCompliance } from "./compliance";
import { recordMessageUsage } from "./stripe-stub";
import { eventBus } from "./eventBus";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// The inbound AI engagement pipeline (Manual / Co-Pilot / Auto-Pilot), lifted
// verbatim out of routes/webhooks.ts so the durable per-conversation FIFO
// worker (inboundAiWorker.ts) can drive it. The contact/conversation/message
// persistence, realtime `message:new` push, and automation engine all still run
// inline on the webhook's post-ack path; only THIS — the slow, serialized AI
// step — is staged and run here.
//
// Everything is best-effort: the durable inbound writes already happened before
// this runs, so an AI failure is swallowed and logged (never thrown), exactly
// as the inline version behaved. Crash recovery is handled one level up by the
// stage visibility timeout, not by throwing here.
//
// The worker re-reads the tenant + conversation fresh before calling this, so a
// mode flip (e.g. to manual) or opt-out between enqueue and processing is
// honored: the effective engagement mode is resolved here from the live
// per-conversation override ?? the (freshly read) tenant default.
// ---------------------------------------------------------------------------
export interface InboundAiPipelineContext {
  tenant: Tenant;
  tenantSlug: string;
  conversationId: number;
  inboundMessageId: number;
  inboundSid: string | null;
  messageBody: string;
  fromNumber: string;
  /**
   * Whether the automation engine already replied to this inbound. The worker
   * only stages inbounds the engine did NOT handle, so this is false there; the
   * param exists for parity/testing.
   */
  automationHandled?: boolean;
}

// Chip shown near the composer once the customer has been auto-acknowledged but
// the real answer still belongs to a human. The status stays refused/failed so
// the send button stays Blue — the human still owns the reply.
const HOLDING_ACK_REASON_TEXT = "Acknowledged — needs your reply";

/**
 * Auto-Pilot "graceful handback". When Auto-Pilot REFUSES to auto-send (the
 * fail-closed gate blocked it) or its AI draft FAILED, write the Blue handback
 * AND — when the tenant configured a holding phrase — auto-send that phrase
 * verbatim as a content-free acknowledgment (NOT an answer), keeping the
 * handback so a human still owns the real reply.
 *
 * Invariants (best-effort; this NEVER throws past the pipeline's contract):
 *   - Empty/whitespace phrase → exactly today's silent Blue handback (fail-safe).
 *   - Throttle: at most ONE ack per waiting episode. The marker lives on the
 *     conversation_ai_states row (handbackAckSentAt); a same-episode burst short-
 *     circuits here and carries the marker forward without re-sending. A human
 *     send flips the row to human_handled (clearing the marker), ending the
 *     episode so a later inbound may ack afresh.
 *   - Compliance is re-checked at SEND time; any block → send NOTHING, release
 *     the claim, stay silent Blue (no marker, so a later inbound may ack once the
 *     block clears).
 *   - Idempotent via the ai_auto_replies claim (keyed on the inbound SID, or a
 *     stable msg:<id> synthetic when no carrier SID); released on send failure.
 *   - Never learns (no fact persistence on this path).
 *   - The AI's real draft is preserved in draftBody for the human.
 */
async function maybeHandbackWithHoldingAck(opts: {
  tenant: Tenant;
  tenantSlug: string;
  conversationId: number;
  inboundMessageId: number;
  inboundSid: string | null;
  fromNumber: string;
  status: "refused" | "failed";
  draftBody: string | null;
  draftSource?: AiDraftSource | null;
  confidence?: string | null;
  queryCategory?: string | null;
  reasonCode: string;
  reasonText: string;
}): Promise<void> {
  const {
    tenant,
    tenantSlug,
    conversationId,
    inboundMessageId,
    inboundSid,
    fromNumber,
    status,
    draftBody,
    draftSource,
    confidence,
    queryCategory,
    reasonCode,
    reasonText,
  } = opts;

  // Write the Blue handback (today's behavior) + publish ai:state. `ack` carries
  // the throttle marker forward when set; `useAckReason` swaps the chip to the
  // "acknowledged" copy once the customer has actually been auto-acked.
  const writeHandback = async (
    ack: { messageId: number | null; sentAt: Date | null } | null,
    useAckReason: boolean,
  ) => {
    await upsertConversationAiState({
      tenantId: tenant.id,
      conversationId,
      status,
      draftBody,
      draftSource,
      confidence,
      queryCategory,
      reasonCode,
      reasonText: useAckReason ? HOLDING_ACK_REASON_TEXT : reasonText,
      latestInboundMessageId: inboundMessageId,
      inboundSid,
      handbackAckMessageId: ack?.messageId ?? null,
      handbackAckSentAt: ack?.sentAt ?? null,
    });
    eventBus.publish(tenant.id, { type: "ai:state", conversationId });
  };

  const phrase = tenant.autopilotHoldingPhrase?.trim() ?? "";
  // Opt-out / fail-safe: no phrase → exactly today's silent Blue handback.
  if (!phrase) {
    await writeHandback(null, false);
    return;
  }

  // THROTTLE — once per waiting episode. An existing unresolved Auto-Pilot
  // handback (refused/failed) that we already acked (marker set, no human reply
  // since — a human send would have flipped it to human_handled and cleared the
  // marker) must NOT be re-acked: carry the marker forward, no send.
  let priorAck: { messageId: number | null; sentAt: Date | null } | null = null;
  try {
    const prior = await getConversationAiState(tenant.id, conversationId);
    if (
      prior &&
      (prior.status === "refused" || prior.status === "failed") &&
      prior.handbackAckSentAt != null
    ) {
      priorAck = {
        messageId: prior.handbackAckMessageId,
        sentAt: prior.handbackAckSentAt,
      };
    }
  } catch (err) {
    // Can't determine throttle state → fail SAFE toward NOT double-texting:
    // degrade to today's silent Blue handback for this turn (no send, no marker).
    logger.warn(
      {
        tenantSlug,
        conversationId,
        err: err instanceof Error ? err.message : String(err),
      },
      "SAMA Auto-Pilot holding-ack: prior-state read failed; silent Blue handback",
    );
    await writeHandback(null, false);
    return;
  }
  if (priorAck) {
    await writeHandback(priorAck, true);
    return;
  }

  // Idempotency: claim the inbound before sending so a webhook retry can't
  // double-send the ack. No carrier SID (rare) → key on the inbound message id.
  const claimKey = inboundSid ?? `msg:${inboundMessageId}`;
  let claimed: { id: number }[];
  try {
    claimed = await db
      .insert(aiAutoRepliesTable)
      .values({ tenantId: tenant.id, inboundSid: claimKey })
      .onConflictDoNothing({
        target: [aiAutoRepliesTable.tenantId, aiAutoRepliesTable.inboundSid],
      })
      .returning({ id: aiAutoRepliesTable.id });
  } catch (err) {
    logger.warn(
      {
        tenantSlug,
        conversationId,
        err: err instanceof Error ? err.message : String(err),
      },
      "SAMA Auto-Pilot holding-ack: claim insert failed; silent Blue handback",
    );
    await writeHandback(null, false);
    return;
  }

  if (claimed.length === 0) {
    // Another invocation already owns this inbound's ack (a retry/race). Do not
    // re-send; preserve whatever marker the winner may have written so the
    // throttle stays intact.
    let carry: { messageId: number | null; sentAt: Date | null } | null = null;
    try {
      const cur = await getConversationAiState(tenant.id, conversationId);
      if (cur && cur.handbackAckSentAt != null) {
        carry = {
          messageId: cur.handbackAckMessageId,
          sentAt: cur.handbackAckSentAt,
        };
      }
    } catch {
      // ignore — fall through with no carry
    }
    await writeHandback(carry, carry != null);
    return;
  }

  // Re-check outbound compliance at SEND time (TOCTOU). Any block → send
  // NOTHING, release the claim, stay silent Blue (no marker, so a later inbound
  // may ack once the block clears). Fail CLOSED on a thrown check.
  let complianceOk = false;
  try {
    const c = await checkOutboundCompliance(tenant.id, tenantSlug, fromNumber);
    complianceOk = c.ok;
  } catch (err) {
    logger.warn(
      {
        tenantSlug,
        conversationId,
        err: err instanceof Error ? err.message : String(err),
      },
      "SAMA Auto-Pilot holding-ack: compliance recheck failed; blocking ack",
    );
  }
  if (!complianceOk) {
    try {
      await db
        .delete(aiAutoRepliesTable)
        .where(eq(aiAutoRepliesTable.id, claimed[0].id));
    } catch (releaseErr) {
      logger.error(
        {
          tenantSlug,
          conversationId,
          err:
            releaseErr instanceof Error
              ? releaseErr.message
              : String(releaseErr),
        },
        "SAMA Auto-Pilot holding-ack: failed to release claim after compliance block",
      );
    }
    await writeHandback(null, false);
    logger.info(
      { tenantSlug, conversationId },
      "SAMA Auto-Pilot holding-ack: compliance blocked the ack; silent Blue handback",
    );
    return;
  }

  // Send the holding phrase verbatim. The compliance check just ran, so skip the
  // duplicate check inside sendConversationReply.
  let claimFinalized = false;
  try {
    const sent = await sendConversationReply({
      tenantId: tenant.id,
      tenantSlug,
      conversationId,
      contactPhone: fromNumber,
      departmentId: null,
      body: phrase,
      senderName: "Textitie AI",
      conductorAuthorized: true,
      runComplianceCheck: false,
    });
    if (sent.ok && sent.status === "sent") {
      await db
        .update(aiAutoRepliesTable)
        .set({ outboundMessageId: sent.messageRow.id })
        .where(eq(aiAutoRepliesTable.id, claimed[0].id));
      // Claim now terminal: any throw past here is post-send bookkeeping only.
      claimFinalized = true;
      await db
        .update(conversationsTable)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversationsTable.id, conversationId));
      // Keep the Blue handback, record the ack marker, swap the chip copy.
      await writeHandback(
        { messageId: sent.messageRow.id, sentAt: new Date() },
        true,
      );
      recordMessageUsage(tenant.id, tenantSlug).catch((e) =>
        logger.warn(
          { err: e, tenantId: tenant.id },
          "Usage tracking failed (non-blocking)",
        ),
      );
      eventBus.publish(tenant.id, {
        type: "message:new",
        conversationId,
        direction: "outbound",
      });
      logger.info(
        { tenantSlug, conversationId, messageId: sent.messageRow.id },
        "SAMA Auto-Pilot: auto-sent holding ack; kept Blue handback",
      );
    } else {
      // Claimed but the ack did not go out → release the claim and stay silent
      // Blue (no marker) so a later inbound may retry.
      await db
        .delete(aiAutoRepliesTable)
        .where(eq(aiAutoRepliesTable.id, claimed[0].id));
      claimFinalized = true;
      await writeHandback(null, false);
      logger.error(
        {
          tenantSlug,
          conversationId,
          reason: sent.ok ? sent.status : sent.reason,
        },
        "SAMA Auto-Pilot holding-ack: send did not complete; released claim, silent Blue handback",
      );
    }
  } catch (sendErr) {
    const sendErrMsg =
      sendErr instanceof Error ? sendErr.message : String(sendErr);
    if (!claimFinalized) {
      try {
        await db
          .delete(aiAutoRepliesTable)
          .where(eq(aiAutoRepliesTable.id, claimed[0].id));
      } catch (releaseErr) {
        logger.error(
          {
            tenantSlug,
            conversationId,
            err:
              releaseErr instanceof Error
                ? releaseErr.message
                : String(releaseErr),
          },
          "SAMA Auto-Pilot holding-ack: failed to release claim after send error",
        );
      }
      try {
        await writeHandback(null, false);
      } catch (stateErr) {
        logger.error(
          {
            tenantSlug,
            conversationId,
            err:
              stateErr instanceof Error ? stateErr.message : String(stateErr),
          },
          "SAMA Auto-Pilot holding-ack: failed to write Blue handback after send error",
        );
      }
      logger.error(
        { tenantSlug, conversationId, err: sendErrMsg },
        "SAMA Auto-Pilot holding-ack: send threw; released claim, silent Blue handback",
      );
    } else {
      // The ack already went out; only post-send bookkeeping failed.
      logger.warn(
        { tenantSlug, conversationId, err: sendErrMsg },
        "SAMA Auto-Pilot holding-ack: post-send step failed (non-blocking); ack already sent",
      );
    }
  }
}

// Built-in acks used when the tenant has NOT configured an autopilotHoldingPhrase,
// so the fail-OPEN promise (the conversation always gets a reply) holds even with
// zero tenant config. A configured holding phrase overrides both.
const DEFAULT_AUTOPILOT_FALLBACK_ACK =
  "Thanks for your message! I don't have an answer for that just yet — let me look into it and follow up shortly.";
const DEFAULT_AUTOPILOT_FINAL_ACK =
  "Thanks for your patience. I'm passing this to a member of our team who'll follow up with you directly.";

// Inbox chip copy once the breaker steps a conversation down to manual (BLUE).
const AUTOPILOT_STEPDOWN_REASON_TEXT =
  "Auto-Pilot paused after repeated out-of-scope messages — reply manually or update the Classroom, then re-enable Auto-Pilot.";

/**
 * AUTO-PILOT closed-book fail-OPEN responder + fallback circuit breaker.
 *
 * Decision logic lives in the pure `evaluateAutoPilotTurn` (the "Gate Table");
 * this function is the I/O shell that gathers its inputs and enacts its verdict.
 *
 * Invariants (the redesign's hard contract):
 *   - CLOSED-BOOK: answers ONLY from the approved Classroom index. NO live
 *     Professor escalation, NO Library read, NO fact persistence (Learns = No).
 *   - FAIL-OPEN: a knowledge miss (or responder error) still sends a graceful
 *     ack so the conversation never stalls; it never goes silent.
 *   - BREAKER: 3 consecutive fallbacks OR >3 in a rolling 2-min window send a
 *     final ack and step the conversation down to manual (BLUE) via
 *     `engagementModeOverride = 'manual'`; a human re-enables it (no auto-clear).
 *   - HARD compliance/opt-out: re-checked at send time inside
 *     `sendConversationReply`; a block suppresses the AI entirely.
 *   - Idempotent via the `ai_auto_replies` claim (keyed on the inbound SID, or a
 *     `msg:<id>` synthetic when no carrier SID); released on a failed send so a
 *     webhook retry can re-attempt. The turn event is likewise idempotent on
 *     (tenantId, inboundMessageId), so a retry never double-counts the breaker.
 *
 * Best-effort like the rest of the pipeline: EXPECTED outcomes (compliance hold,
 * send failure) are handled inline and return normally; an UNEXPECTED failure
 * propagates so the FIFO worker can retry the burst.
 */
async function runAutoPilotFailOpenTurn(
  ctx: InboundAiPipelineContext,
): Promise<void> {
  const {
    tenant,
    tenantSlug,
    conversationId,
    inboundMessageId,
    inboundSid,
    messageBody,
    fromNumber,
  } = ctx;

  const queryCategory = classifyQueryCategory(messageBody);
  // Declared up front so the failure-handback closure below can preserve a
  // stitched answer (if any) for the human; assigned in the retrieval block.
  let answerText = "";

  // Blue "failed" handback used when a send we DECIDED to make could not be
  // delivered (infra failure, NOT a knowledge miss) — so it records no turn
  // event and never moves the breaker. Preserves a stitched answer (if any) as a
  // draft for the human.
  const writeFailedHandback = async () => {
    await upsertConversationAiState({
      tenantId: tenant.id,
      conversationId,
      status: "failed",
      draftBody: answerText.length > 0 ? answerText : null,
      draftSource: answerText.length > 0 ? "student" : null,
      confidence: null,
      queryCategory,
      reasonCode: "send_failed",
      reasonText: describeHandbackReason(["send_failed"]),
      latestInboundMessageId: inboundMessageId,
      inboundSid,
    });
  };

  // Row 1 — a human already took THIS turn (or a newer one). Defer entirely: no
  // send, no event, leave the human_handled state intact.
  try {
    const prior = await getConversationAiState(tenant.id, conversationId);
    if (
      prior &&
      prior.status === "human_handled" &&
      (prior.latestInboundMessageId == null ||
        prior.latestInboundMessageId >= inboundMessageId)
    ) {
      logger.info(
        { tenantSlug, conversationId },
        "SAMA Auto-Pilot: human already handled this turn; deferring",
      );
      return;
    }
  } catch (err) {
    // Non-fatal: the ai_auto_replies claim + human-send fencing still prevent a
    // double reply, so continue rather than stall.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "SAMA Auto-Pilot: prior-state read failed (continuing)",
    );
  }

  // CLOSED-BOOK retrieval — the approved Classroom index ONLY.
  let facts: ClassroomFact[] = [];
  let matchType: ClassroomMatchType = "none";
  try {
    const retrieval = await retrieveClassroomFactsWithMatch(
      tenant.id,
      messageBody,
      { category: queryCategory },
    );
    facts = retrieval.facts;
    matchType = retrieval.matchType;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "SAMA Auto-Pilot: classroom retrieval failed; treating as no match",
    );
  }
  // A real FTS hit or a weaker-but-real coverage hit (relevant fact present) both
  // count as grounded — mirroring the Co-Pilot/Auto-Pilot grounding signal.
  const knowledgeMatched =
    (matchType === "fts" || matchType === "coverage") && facts.length > 0;

  // Stitch a grounded answer with the FAST Student — ONLY on a match, and ONLY
  // from the approved facts (no Library, no Professor). A miss never calls the
  // Student: we go straight to a graceful ack (closed-book + low latency).
  let responderErrored = false;
  if (knowledgeMatched) {
    const classroomContext = facts
      .map((f) => `- ${f.statement} (source: ${f.sourceLabel})`)
      .join("\n");
    try {
      const draft = await studentWhisper({
        tenant,
        fromNumber,
        inboundBody: messageBody,
        classroomContext,
      });
      const reply = draft.draftReply.trim();
      if (draft.status === "drafted" && reply.length > 0) {
        answerText = reply;
      } else {
        // Grounded but the Student produced nothing usable → Row 6 (error
        // fallback). Never silent.
        responderErrored = true;
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "SAMA Auto-Pilot: Student stitch threw; treating as responder error",
      );
      responderErrored = true;
    }
  }

  // HARD compliance precheck (re-checked again at send time). Fail CLOSED on a
  // thrown check so a broken compliance read can never auto-send.
  let complianceOk = false;
  try {
    const c = await checkOutboundCompliance(tenant.id, tenantSlug, fromNumber);
    complianceOk = c.ok;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "SAMA Auto-Pilot: compliance precheck threw; suppressing this turn",
    );
  }

  // Prior breaker tallies (turns BEFORE this one). Fail OPEN to zero so a
  // counting hiccup can never spuriously step a tenant down.
  const now = new Date();
  let consecutiveFallbacks = 0;
  let fallbacksInWindow = 0;
  try {
    const counts = await getAutopilotFallbackCounts(
      tenant.id,
      conversationId,
      now,
    );
    consecutiveFallbacks = counts.consecutive;
    fallbacksInWindow = counts.inWindow;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "SAMA Auto-Pilot: fallback-count read failed; assuming zero",
    );
  }

  const decision = evaluateAutoPilotTurn({
    engagementMode: "autopilot",
    knowledgeMatched,
    responderErrored,
    complianceOk,
    humanHandledThisTurn: false, // the early defer above already handled this
    consecutiveFallbacks,
    fallbacksInWindow,
  });

  logger.info(
    {
      tenantSlug,
      conversationId,
      matchType,
      knowledgeMatched,
      responderErrored,
      complianceOk,
      consecutiveFallbacks,
      fallbacksInWindow,
      action: decision.action,
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
    },
    "SAMA Auto-Pilot: gate decision",
  );

  // ---- ENACT ----

  // Row 1 (belt-and-suspenders) — pure defer.
  if (decision.action === "defer") {
    return;
  }

  // Row 0 — compliance hold: send NOTHING. Record for audit (neutral to the
  // breaker) and clear any actionable AI state so the inbox shows no draft.
  if (decision.action === "suppress") {
    try {
      await recordAutopilotTurnEvent({
        tenantId: tenant.id,
        conversationId,
        inboundMessageId,
        inboundSid,
        outcome: "compliance_block",
        replyKind: "none",
        reasonCode: decision.reasonCode,
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "SAMA Auto-Pilot: compliance event record failed (non-blocking)",
      );
    }
    try {
      await supersedeConversationAiState({
        tenantId: tenant.id,
        conversationId,
        latestInboundMessageId: inboundMessageId,
      });
      eventBus.publish(tenant.id, { type: "ai:state", conversationId });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "SAMA Auto-Pilot: compliance state supersede failed (non-blocking)",
      );
    }
    logger.info(
      { tenantSlug, conversationId },
      "SAMA Auto-Pilot: compliance hold; suppressed AI",
    );
    return;
  }

  // answer | fallback | stepdown — all SEND a message, then record the event.
  const holdingPhrase = tenant.autopilotHoldingPhrase?.trim() ?? "";
  let body: string;
  if (decision.action === "answer" && answerText.length > 0) {
    body = answerText;
  } else if (decision.action === "stepdown") {
    body = holdingPhrase.length > 0 ? holdingPhrase : DEFAULT_AUTOPILOT_FINAL_ACK;
  } else {
    // fallback, or a defensive degraded "answer" with no text.
    body =
      holdingPhrase.length > 0 ? holdingPhrase : DEFAULT_AUTOPILOT_FALLBACK_ACK;
  }

  // outcome is non-null for answer|fallback|stepdown (see evaluateAutoPilotTurn).
  const outcome = decision.outcome!;
  const claimKey = inboundSid ?? `msg:${inboundMessageId}`;

  // Idempotency: claim the inbound before sending so a webhook retry can't
  // double-send or double-count the breaker.
  let claimed: { id: number }[];
  try {
    claimed = await db
      .insert(aiAutoRepliesTable)
      .values({ tenantId: tenant.id, inboundSid: claimKey })
      .onConflictDoNothing({
        target: [aiAutoRepliesTable.tenantId, aiAutoRepliesTable.inboundSid],
      })
      .returning({ id: aiAutoRepliesTable.id });
  } catch (err) {
    logger.error(
      {
        tenantSlug,
        conversationId,
        err: err instanceof Error ? err.message : String(err),
      },
      "SAMA Auto-Pilot: claim insert failed; Blue handback",
    );
    try {
      await writeFailedHandback();
      eventBus.publish(tenant.id, { type: "ai:state", conversationId });
    } catch {
      // best-effort
    }
    return;
  }

  if (claimed.length === 0) {
    // A retry/race — another invocation already owns this inbound. Do NOT
    // re-send or re-count; the winner recorded the turn event.
    logger.info(
      { tenantSlug, conversationId },
      "SAMA Auto-Pilot: inbound already claimed (idempotent skip)",
    );
    return;
  }

  let claimFinalized = false;
  try {
    const sent = await sendConversationReply({
      tenantId: tenant.id,
      tenantSlug,
      conversationId,
      contactPhone: fromNumber,
      departmentId: null,
      body,
      senderName: "Textitie AI",
      conductorAuthorized: true,
    });

    if (sent.ok && sent.status === "sent") {
      await db
        .update(aiAutoRepliesTable)
        .set({ outboundMessageId: sent.messageRow.id })
        .where(eq(aiAutoRepliesTable.id, claimed[0].id));
      // Claim now terminal: any throw past here is post-send bookkeeping only.
      claimFinalized = true;
      await db
        .update(conversationsTable)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversationsTable.id, conversationId));

      // Record the turn event (idempotent) — this drives the breaker tallies.
      try {
        await recordAutopilotTurnEvent({
          tenantId: tenant.id,
          conversationId,
          inboundMessageId,
          inboundSid,
          outcome,
          replyKind: decision.replyKind,
          outboundMessageId: sent.messageRow.id,
          reasonCode: decision.reasonCode,
        });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "SAMA Auto-Pilot: turn event record failed (non-blocking)",
        );
      }

      // Breaker tripped → flip the conversation to manual (BLUE). A human
      // re-enables Auto-Pilot (no auto-clear).
      if (decision.setOverrideManual) {
        try {
          await db
            .update(conversationsTable)
            .set({ engagementModeOverride: "manual" })
            .where(eq(conversationsTable.id, conversationId));
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            "SAMA Auto-Pilot: stepdown override write failed",
          );
        }
      }

      // AI state for the inbox button/chip.
      if (decision.action === "stepdown") {
        // Final ack went out; conversation is now paused awaiting a human.
        await upsertConversationAiState({
          tenantId: tenant.id,
          conversationId,
          status: "refused",
          draftBody: null,
          draftSource: null,
          confidence: null,
          queryCategory,
          reasonCode: decision.reasonCode,
          reasonText: AUTOPILOT_STEPDOWN_REASON_TEXT,
          latestInboundMessageId: inboundMessageId,
          inboundSid,
          outboundMessageId: sent.messageRow.id,
        });
      } else {
        // answer | fallback — AI handled this turn autonomously (GREEN).
        await upsertConversationAiState({
          tenantId: tenant.id,
          conversationId,
          status: "auto_sent",
          draftBody: null,
          draftSource: "student",
          confidence: null,
          queryCategory,
          reasonCode: decision.reasonCode,
          latestInboundMessageId: inboundMessageId,
          inboundSid,
          outboundMessageId: sent.messageRow.id,
          autoSentAt: new Date(),
        });
      }

      recordMessageUsage(tenant.id, tenantSlug).catch((e) =>
        logger.warn(
          { err: e, tenantId: tenant.id },
          "Usage tracking failed (non-blocking)",
        ),
      );
      eventBus.publish(tenant.id, {
        type: "message:new",
        conversationId,
        direction: "outbound",
      });
      eventBus.publish(tenant.id, { type: "ai:state", conversationId });

      try {
        await db.insert(auditLogsTable).values({
          tenantId: tenant.id,
          actorUserId: null,
          actorEmail: "system:ai-autopilot",
          action: "ai.autopilot_turn",
          entityType: "conversation",
          entityId: String(conversationId),
          afterJson: {
            inboundSid,
            messageId: sent.messageRow.id,
            outcome,
            replyKind: decision.replyKind,
            reasonCode: decision.reasonCode,
            steppedDown: decision.setOverrideManual,
            matchType,
            queryCategory,
          },
        });
      } catch (e) {
        logger.warn(
          { err: e instanceof Error ? e.message : String(e) },
          "SAMA Auto-Pilot: audit write failed (non-blocking)",
        );
      }

      // Chatwoot PUBLIC mirror of what the customer received (best-effort).
      if (tenant.chatwootAccountId && tenant.chatwootInboxId) {
        try {
          await postChatwootMessage({
            accountId: tenant.chatwootAccountId,
            inboxId: tenant.chatwootInboxId,
            contactPhone: fromNumber,
            body,
            messageType: "outgoing",
            private: false,
          });
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "SAMA Auto-Pilot: Chatwoot mirror failed (non-blocking)",
          );
        }
      }

      logger.info(
        {
          tenantSlug,
          conversationId,
          messageId: sent.messageRow.id,
          outcome,
          steppedDown: decision.setOverrideManual,
        },
        "SAMA Auto-Pilot: handled turn",
      );
    } else {
      // Claimed but the send did not complete → release the claim so a webhook
      // retry can re-attempt, Blue handback, NO turn event (delivery issue, not
      // a knowledge miss → must not move the breaker).
      await db
        .delete(aiAutoRepliesTable)
        .where(eq(aiAutoRepliesTable.id, claimed[0].id));
      claimFinalized = true;
      await writeFailedHandback();
      eventBus.publish(tenant.id, { type: "ai:state", conversationId });
      logger.error(
        {
          tenantSlug,
          conversationId,
          reason: sent.ok ? sent.status : sent.reason,
        },
        "SAMA Auto-Pilot: send did not complete; released claim, Blue handback",
      );
    }
  } catch (sendErr) {
    const sendErrMsg =
      sendErr instanceof Error ? sendErr.message : String(sendErr);
    if (!claimFinalized) {
      // Send threw before recording an outbound id → customer got nothing.
      // Release the (null) claim so a retry can re-attempt, Blue handback. NOT
      // re-thrown: a send failure is a terminal handback, not a burst retry.
      try {
        await db
          .delete(aiAutoRepliesTable)
          .where(eq(aiAutoRepliesTable.id, claimed[0].id));
      } catch (releaseErr) {
        logger.error(
          {
            tenantSlug,
            conversationId,
            err:
              releaseErr instanceof Error
                ? releaseErr.message
                : String(releaseErr),
          },
          "SAMA Auto-Pilot: failed to release claim after send error",
        );
      }
      try {
        await writeFailedHandback();
        eventBus.publish(tenant.id, { type: "ai:state", conversationId });
      } catch (stateErr) {
        logger.error(
          {
            tenantSlug,
            conversationId,
            err:
              stateErr instanceof Error ? stateErr.message : String(stateErr),
          },
          "SAMA Auto-Pilot: failed to write Blue handback after send error",
        );
      }
      logger.error(
        { tenantSlug, conversationId, err: sendErrMsg },
        "SAMA Auto-Pilot: send threw; released claim, Blue handback",
      );
    } else {
      // The reply already went out (claim terminal); only post-send bookkeeping
      // failed. Leave the claim intact so retries stay idempotent.
      logger.warn(
        { tenantSlug, conversationId, err: sendErrMsg },
        "SAMA Auto-Pilot: post-send step failed (non-blocking); reply already sent",
      );
    }
  }
}

export async function runInboundAiPipeline(
  ctx: InboundAiPipelineContext,
): Promise<void> {
  const {
    tenant,
    tenantSlug,
    conversationId,
    inboundMessageId,
    inboundSid,
    messageBody,
    fromNumber,
  } = ctx;
  const automationHandled = ctx.automationHandled ?? false;

  try {
    const overrideRow = await db
      .select({ override: conversationsTable.engagementModeOverride })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
      .limit(1);
    const engagementMode = resolveEffectiveEngagementMode(
      overrideRow[0]?.override ?? null,
      tenant.engagementMode,
    );

    // MANUAL → AI fully off (no draft/send/learn). AUTOMATION-HANDLED → the
    // engine already replied. Either way: supersede any prior AI state and skip
    // the AI entirely.
    if (engagementMode === "manual" || automationHandled) {
      await supersedeConversationAiState({
        tenantId: tenant.id,
        conversationId,
        latestInboundMessageId: inboundMessageId,
      });
      eventBus.publish(tenant.id, { type: "ai:state", conversationId });
      logger.info(
        {
          tenantSlug,
          conversationId,
          engagementMode,
          automationHandled,
        },
        "SAMA AI: skipped (manual mode or automation handled); state superseded",
      );
      return;
    }

    // Post a PRIVATE whisper draft to Chatwoot (when configured) for the
    // short-circuit Co-Pilot router branches, mirroring the whisper the main
    // draft path posts at the end of the pipeline so Chatwoot-side agents always
    // see the AI's suggested reply.
    const postCopilotWhisper = async (whisperBody: string): Promise<void> => {
      if (!tenant.chatwootAccountId || !tenant.chatwootInboxId) return;
      try {
        const post = await postChatwootMessage({
          accountId: tenant.chatwootAccountId,
          inboxId: tenant.chatwootInboxId,
          contactPhone: fromNumber,
          body: whisperBody,
          messageType: "outgoing",
          private: true,
        });
        logger.info(
          { tenantSlug, whisperPost: post.status, detail: post.detail },
          "SAMA Router: posted Co-Pilot whisper to Chatwoot",
        );
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "SAMA Router: Chatwoot whisper failed (non-blocking)",
        );
      }
    };

    // ---- CO-PILOT triage router (pre-retrieval, CO-PILOT ONLY) ----
    // Classify the inbound BEFORE any retrieval/drafting so the two non-default
    // branches can short-circuit with a composer-only draft. This NEVER runs for
    // Auto-Pilot (its block below is byte-for-byte unchanged) or Manual (already
    // returned above). FAIL-SAFE + FAIL-OPEN: missing GROK_KEYS, no brand scope,
    // a thrown error, or anything short of a CONFIDENT non-default classification
    // falls through to the existing grounded pipeline (tenant_specific). Co-Pilot
    // only ever drafts — never learns, never auto-sends — so neither short-circuit
    // branch persists anything; the customer text stays QUERY-ONLY.
    if (engagementMode === "copilot" && routerConfigured()) {
      const brandScope = (tenant.brandScope ?? "").trim();
      if (brandScope.length > 0) {
        let routerDecision: RouterDecision | null = null;
        try {
          routerDecision = await triageInbound({
            tenant,
            brandScope,
            inboundBody: messageBody,
            fromNumber,
          });
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "SAMA Router: triage threw (failing open to tenant_specific)",
          );
          routerDecision = null;
        }
        const branch = routerDecision
          ? resolveRouteBranch(routerDecision)
          : "tenant_specific";
        logger.info(
          {
            tenantSlug,
            conversationId,
            branch,
            status: routerDecision?.status,
            intent: routerDecision?.intent,
            confidence: routerDecision?.confidence,
            latencyMs: routerDecision?.latencyMs,
          },
          "SAMA Router: triage decision",
        );

        if (branch === "out_of_scope") {
          // Off-brand → LLM-authored short decline drafted into the composer for
          // a human to review/send. Nothing grounded, nothing learned.
          const declineBody = routerDecision!.declineMessage.trim();
          const written = await stageCopilotDraftForInbound({
            tenantId: tenant.id,
            conversationId,
            latestInboundMessageId: inboundMessageId,
            draftBody: declineBody.length > 0 ? declineBody : null,
            draftSource: "router_decline",
            confidence: routerDecision!.confidence,
            queryCategory: null,
            inboundSid,
          });
          if (written) {
            eventBus.publish(tenant.id, { type: "ai:state", conversationId });
          }
          await postCopilotWhisper(
            `[SAMA Router — off-scope decline]\n${declineBody}`,
          );
          logger.info(
            { tenantSlug, conversationId, draftWritten: written },
            "SAMA Router: out_of_scope decline drafted for human review",
          );
          return;
        }

        if (branch === "general_in_scope") {
          // General, in-domain question → Student "flash" draft from Grok's own
          // parametric knowledge: no Classroom retrieval, no Professor hop, no
          // learning. Drafted into the composer for a human.
          const flash = await studentFlashDraft({
            tenant,
            fromNumber,
            inboundBody: messageBody,
            brandScope,
          });
          const flashReply = flash.draftReply.trim();
          const written = await stageCopilotDraftForInbound({
            tenantId: tenant.id,
            conversationId,
            latestInboundMessageId: inboundMessageId,
            draftBody: flashReply.length > 0 ? flashReply : null,
            draftSource: "student_flash",
            confidence: null,
            queryCategory: null,
            inboundSid,
          });
          if (written) {
            eventBus.publish(tenant.id, { type: "ai:state", conversationId });
          }
          await postCopilotWhisper(flash.whisperBody);
          logger.info(
            {
              tenantSlug,
              conversationId,
              status: flash.status,
              latencyMs: flash.latencyMs,
              hasDraft: flashReply.length > 0,
              draftWritten: written,
            },
            "SAMA Router: general_in_scope flash draft staged for human review",
          );
          return;
        }
        // branch === "tenant_specific" → fall through to the existing pipeline.
      }
    }

    // ---- AUTO-PILOT SEAM (closed-book fail-OPEN responder) ----
    // Auto-Pilot NO LONGER shares the Co-Pilot draft/Professor path below. It
    // answers ONLY from the approved Classroom index (closed-book: no live
    // Professor escalation, no Library, no learning), sends a graceful ack on a
    // miss so the conversation never stalls, and trips a fallback circuit breaker
    // (3 in a row OR >3 in 2 min) that steps the conversation down to manual.
    // Returning here leaves the entire shared path below Co-Pilot-only in
    // practice (Manual already returned above); Co-Pilot logic is byte-for-byte
    // unchanged.
    if (engagementMode === "autopilot") {
      await runAutoPilotFailOpenTurn(ctx);
      return;
    }

    // CO-PILOT path: retrieve Classroom grounding for the draft. (Auto-Pilot
    // returned at the seam above; Manual returned earlier.)
    const queryCategory = classifyQueryCategory(messageBody);
    let facts: ClassroomFact[] = [];
    // A real FTS hit (every non-stopword term present in a Classroom fact) is a
    // deterministic grounding signal we trust over the Student's brittle
    // self-report: it suppresses needless slow Professor escalation (gate below)
    // AND lets Auto-Pilot auto-answer grounded questions (evaluateAutoSend).
    let classroomMatch: ClassroomMatchType = "none";
    let classroomTopRank: number | null = null;
    try {
      const retrieval = await retrieveClassroomFactsWithMatch(
        tenant.id,
        messageBody,
        { category: queryCategory },
      );
      facts = retrieval.facts;
      classroomMatch = retrieval.matchType;
      classroomTopRank = retrieval.topRank;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "SAMA Student: classroom retrieval failed, falling back to legacy KB",
      );
    }
    const strongClassroomMatch = classroomMatch === "fts";
    // Coverage is a weaker-but-real grounding signal: the relevant fact is
    // present, so we treat the turn as grounded (skip the slow Professor
    // escalation and suppress the Co-Pilot holding fallback). Auto-Pilot's gate
    // still demands a "high" confidence self-report before sending — only a full
    // FTS hit bypasses that (see evaluateAutoSend).
    const coverageClassroomMatch = classroomMatch === "coverage";
    const classroomGrounded = strongClassroomMatch || coverageClassroomMatch;
    const classroomContext = facts
      .map((f) => `- ${f.statement} (source: ${f.sourceLabel})`)
      .join("\n");

    const draft = await studentWhisper({
      tenant,
      fromNumber,
      inboundBody: messageBody,
      classroomContext,
    });
    logger.info(
      {
        tenantSlug,
        engagementMode,
        status: draft.status,
        latencyMs: draft.latencyMs,
        detail: draft.detail,
        classroomMatch,
        classroomTopRank,
        whisperPreview: draft.whisperBody.slice(0, 500),
      },
      "SAMA Student: draft ready",
    );

    // ---- CO-PILOT fallback holding phrase (tenant-specific + UNGROUNDED) ----
    // When a Co-Pilot tenant has a fallback phrase configured AND this inbound is
    // ungrounded (no Classroom FTS hit and the Student found no KB answer), draft
    // the human-written holding phrase VERBATIM instead of letting the
    // Student/Professor guess at brand-specific pricing/policy/account facts. This
    // is a composer-only draft: a human edits + sends and can trigger the
    // Professor + Human loop. NEVER auto-sends, NEVER learns. We early-return
    // (mirroring the router branches) so the slow Professor escalation is skipped
    // — the whole point is "do not guess". FAIL-OPEN: empty phrase falls through
    // to the existing Professor/Student path. Auto-Pilot + Manual are untouched
    // (Manual already returned above; Auto-Pilot is the else branch below and
    // this gate is Co-Pilot-only).
    const fallbackPhrase = (tenant.fallbackPhrase ?? "").trim();
    const ungrounded = !draft.kbMatched && !classroomGrounded;
    if (
      engagementMode === "copilot" &&
      fallbackPhrase.length > 0 &&
      ungrounded
    ) {
      const written = await stageCopilotDraftForInbound({
        tenantId: tenant.id,
        conversationId,
        latestInboundMessageId: inboundMessageId,
        draftBody: fallbackPhrase,
        draftSource: "fallback_phrase",
        confidence: null,
        queryCategory,
        inboundSid,
      });
      if (written) {
        eventBus.publish(tenant.id, { type: "ai:state", conversationId });
      }
      await postCopilotWhisper(
        `[SAMA Fallback — ungrounded holding draft]\n${fallbackPhrase}\n(No Classroom/KB match for a tenant-specific question — edit/send this stall, then trigger the Professor + Human loop for the real answer.)`,
      );
      logger.info(
        { tenantSlug, conversationId, draftWritten: written },
        "SAMA Co-Pilot: fallback holding phrase drafted (ungrounded tenant-specific)",
      );
      return;
    }

    // ---- Professor escalation (GENERATE + SCREEN ONLY here) ----
    // When the Student is ungrounded, the Professor answers from the Library +
    // its expertise: a better DRAFT now, and (Auto-Pilot only, AFTER a
    // confirmed verbatim auto-send) the facts we LEARN. We DELIBERATELY do not
    // persist here — learning is gated on an autonomous, unedited send (the
    // unifying learning rule). The customer's text is UNTRUSTED — a question,
    // never truth.
    let escalation: ProfessorEscalation | null = null;
    let escalatedCategories: FactCategory[] = [];
    // Set true when the streaming escalation staged a Co-Pilot draft early
    // (reply surfaced before the fact-reasoning finished), so the finalize
    // below updates-in-place instead of re-upserting.
    let copilotEarlyDraftFired = false;
    // No in-process throttle needed anymore: the durable per-conversation FIFO
    // (one inbound in flight per conversation) already prevents the same
    // conversation from fanning out concurrent escalations, and natural dedup
    // (once facts persist, the identical question is grounded) handles repeats.
    // Trust a real Classroom FTS hit over the Student's self-report: when the
    // answer terms are literally in the Classroom, skip the slow Professor
    // escalation entirely (the dominant latency source) and answer from the
    // grounded Student draft.
    if (
      professorConfigured() &&
      draft.status === "drafted" &&
      !draft.kbMatched &&
      !classroomGrounded
    ) {
      try {
        const lib = await retrieveLibraryContext(tenant.id, messageBody);
        const libraryContext = lib
          .map((c) => c.text)
          .join("\n\n")
          .slice(0, 8000);
        escalation = await professorEscalate(
          {
            tenantName: tenant.name,
            libraryContext,
            question: messageBody,
          },
          // Co-Pilot ONLY: stage the customer reply the instant it finishes
          // streaming — before the slow fact-reasoning — so the composer
          // prefills immediately. Auto-Pilot passes no callback: its send gate
          // needs the screened facts + confidence, so it cannot act early (the
          // "Professor tax" is intentional). Best-effort; the authoritative
          // copilot write happens at finalize below.
          engagementMode === "copilot"
            ? async (reply) => {
                // Guarded: a no-op (false) means a human took the wheel or a
                // newer turn landed mid-stream — don't claim the early draft or
                // notify in that case.
                const staged = await stageCopilotDraftForInbound({
                  tenantId: tenant.id,
                  conversationId,
                  latestInboundMessageId: inboundMessageId,
                  draftBody: reply,
                  draftSource: "professor",
                  confidence: null,
                  queryCategory,
                  inboundSid,
                });
                if (staged) {
                  copilotEarlyDraftFired = true;
                  eventBus.publish(tenant.id, {
                    type: "ai:state",
                    conversationId,
                  });
                }
              }
            : undefined,
        );
        escalatedCategories = Array.from(
          new Set(escalation.facts.map((f) => normalizeCategory(f.category))),
        );
        logger.info(
          {
            tenantSlug,
            conversationId,
            status: escalation.status,
            confidence: escalation.confidence,
            screenedFacts: escalation.facts.length,
            categories: escalatedCategories,
          },
          "SAMA Professor: escalation drafted (persist gated on auto-send)",
        );
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "SAMA Professor: escalation failed (non-blocking)",
        );
        escalation = null;
      }
    }

    // The Professor answer supersedes the Student draft as the reply when it
    // produced screened facts AND a customer reply.
    const escalated =
      !!escalation &&
      escalation.status === "answered" &&
      escalation.facts.length > 0 &&
      escalation.customerReply.trim().length > 0;
    const replyText = escalated
      ? escalation!.customerReply.trim()
      : draft.draftReply.trim();
    const draftSource: "student" | "professor" = escalated
      ? "professor"
      : "student";
    const replyConfidence = escalated
      ? escalation!.confidence
      : draft.confidence;
    const whisperToPost = escalated
      ? `[SAMA Professor — escalation]\n${escalation!.customerReply.trim()}\n(confidence ${escalation!.confidence}; ${escalation!.facts.length} fact(s) ready to learn on auto-send)`
      : draft.whisperBody;

    let autoSent = false;

    // ============ CO-PILOT ============
    // Draft into the composer for a human to edit + send. NEVER auto-sends and
    // NEVER learns.
    if (engagementMode === "copilot") {
      let draftWritten: boolean;
      if (copilotEarlyDraftFired) {
        // The streaming callback already staged the draft early. Finalize it
        // with the authoritative reply + confidence, guarded so we never
        // clobber a human takeover or a newer inbound turn that landed during
        // the stream.
        draftWritten = await finalizeCopilotDraftForInbound({
          tenantId: tenant.id,
          conversationId,
          latestInboundMessageId: inboundMessageId,
          draftBody: replyText.length > 0 ? replyText : null,
          draftSource,
          confidence: replyConfidence,
          queryCategory,
          inboundSid,
        });
      } else {
        // No early stream draft (stub/grok-off/grounded/stream failure).
        // Guarded like the early write so a concurrent human takeover or newer
        // turn is never clobbered.
        draftWritten = await stageCopilotDraftForInbound({
          tenantId: tenant.id,
          conversationId,
          latestInboundMessageId: inboundMessageId,
          draftBody: replyText.length > 0 ? replyText : null,
          draftSource,
          confidence: replyConfidence,
          queryCategory,
          inboundSid,
        });
      }
      // Only notify the inbox when the guarded write actually changed the row.
      // A no-op means a human took the wheel or a newer turn landed
      // mid-pipeline — re-emitting ai:state there would re-surface a draft for
      // an already-resolved turn (the composer re-fill bug). The human-send
      // path emits its own ai:state when it flips the row to human_handled.
      if (draftWritten) {
        eventBus.publish(tenant.id, { type: "ai:state", conversationId });
      }
      logger.info(
        {
          tenantSlug,
          conversationId,
          draftSource,
          hasDraft: replyText.length > 0,
          earlyStreamed: copilotEarlyDraftFired,
          draftWritten,
        },
        "SAMA Co-Pilot: draft staged for human review",
      );
    } else {
      // ============ AUTO-PILOT (LEGACY — now UNREACHABLE) ============
      // NOTE: with the Auto-Pilot SEAM above, autopilot turns return early via
      // runAutoPilotFailOpenTurn and never reach this branch (manual returned
      // even earlier, so only copilot takes the `if` above). This fail-closed +
      // Professor-coupled gate is retained verbatim pending removal in a
      // follow-up — DO NOT extend it; new Auto-Pilot behavior lives in
      // runAutoPilotFailOpenTurn.
      const groundingCategories = facts.map((f) =>
        normalizeCategory(f.category),
      );

      if (draft.status !== "drafted" && !escalated) {
        // Grok produced no usable draft → Blue handback (failed). Auto-send the
        // tenant's holding phrase (if configured) so the customer is acked while
        // a human picks up the real answer.
        await maybeHandbackWithHoldingAck({
          tenant,
          tenantSlug,
          conversationId,
          inboundMessageId,
          inboundSid,
          fromNumber,
          status: "failed",
          draftBody: null,
          confidence: draft.confidence,
          queryCategory,
          reasonCode: "grok_error",
          reasonText: describeHandbackReason(["grok_error"]),
        });
        logger.warn(
          { tenantSlug, conversationId, draftStatus: draft.status },
          "SAMA Auto-Pilot: Grok produced no draft; Blue handback",
        );
      } else {
        // Conflict check spans the answer's categories PLUS the always-sensitive
        // pricing/compliance ones and the query intent. Compliance is
        // re-checked at send time too.
        const conflictCats = Array.from(
          new Set<FactCategory>([
            ...(escalated ? escalatedCategories : groundingCategories),
            "pricing",
            "compliance",
            ...(queryCategory ? [queryCategory] : []),
          ]),
        );
        let hasConflict = true; // fail closed if the check throws
        try {
          hasConflict = await hasUnresolvedConflicts(tenant.id, conflictCats);
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "SAMA Auto-Pilot: conflict check failed; blocking auto-send",
          );
        }
        let complianceOk = false;
        try {
          const c = await checkOutboundCompliance(
            tenant.id,
            tenantSlug,
            fromNumber,
          );
          complianceOk = c.ok;
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "SAMA Auto-Pilot: compliance precheck failed; blocking auto-send",
          );
        }

        const decision = escalated
          ? evaluateProfessorEscalationSend({
              engagementMode,
              professorConfigured: professorConfigured(),
              escalationStatus: escalation!.status,
              confidence: escalation!.confidence,
              screenedFactCount: escalation!.facts.length,
              hasReply: replyText.length > 0,
              escalatedCategories,
              queryCategory,
              hasConflict,
              complianceOk,
              automationHandled,
            })
          : evaluateAutoSend({
              engagementMode,
              draftStatus: draft.status,
              confidence: draft.confidence,
              kbMatched: draft.kbMatched,
              groundedInClassroom: draft.groundedInClassroom,
              strongClassroomMatch,
              coverageClassroomMatch,
              queryCategory,
              groundingCategories,
              hasConflict,
              complianceOk,
            });

        if (decision.autoSend && inboundSid && replyText) {
          // Idempotency: claim the inbound SID before sending. The unique
          // (tenant_id, inbound_sid) index lets exactly one caller win, so a
          // webhook retry can never double-send.
          const claimed = await db
            .insert(aiAutoRepliesTable)
            .values({ tenantId: tenant.id, inboundSid })
            .onConflictDoNothing({
              target: [
                aiAutoRepliesTable.tenantId,
                aiAutoRepliesTable.inboundSid,
              ],
            })
            .returning({ id: aiAutoRepliesTable.id });

          if (claimed.length > 0) {
            // The claim row is non-terminal (outboundMessageId still null) until
            // a confirmed send records the outbound id OR we explicitly release
            // it. If the send THROWS before either happens, we MUST release the
            // claim here: a leaked null-id row makes the existing-claim check
            // below permanently suppress every retry of this inbound SID.
            // claimFinalized guards a double-release and prevents a post-send
            // bookkeeping throw from undoing a reply that already went out.
            let claimFinalized = false;
            try {
              const sent = await sendConversationReply({
                tenantId: tenant.id,
                tenantSlug,
                conversationId,
                contactPhone: fromNumber,
                departmentId: null,
                body: replyText,
                senderName: "Textitie AI",
                conductorAuthorized: true,
              });
              if (sent.ok && sent.status === "sent") {
                autoSent = true;
                await db
                  .update(aiAutoRepliesTable)
                  .set({ outboundMessageId: sent.messageRow.id })
                  .where(eq(aiAutoRepliesTable.id, claimed[0].id));
                // Claim now carries the outbound id → terminal. Any throw past
                // this point is post-send bookkeeping only; the reply already went
                // out, so the catch below must NOT release the claim.
                claimFinalized = true;
                await db
                  .update(conversationsTable)
                  .set({ lastMessageAt: new Date() })
                  .where(eq(conversationsTable.id, conversationId));

                // ---- LEARN (only here) ----
                // The reply went out autonomously and verbatim, so persist the
                // Professor's screened facts as Classroom truth (so we never ask
                // twice). No human-touch path ever reaches this line.
                let learnedFacts = 0;
                if (escalated) {
                  try {
                    const persistResult = await persistEscalatedFacts(
                      tenant.id,
                      escalation!.facts,
                    );
                    learnedFacts = persistResult.persisted;
                    logger.info(
                      {
                        tenantSlug,
                        conversationId,
                        persisted: learnedFacts,
                        flagged: persistResult.flagged,
                        versionId: persistResult.versionId,
                        categories: escalatedCategories,
                      },
                      "SAMA Professor: learned facts after autonomous send",
                    );
                    try {
                      await db.insert(auditLogsTable).values({
                        tenantId: tenant.id,
                        actorUserId: null,
                        actorEmail: "system:ai-professor",
                        action: "ai.professor_escalation",
                        entityType: "conversation",
                        entityId: String(conversationId),
                        afterJson: {
                          inboundSid,
                          confidence: escalation!.confidence,
                          factsReturned: escalation!.facts.length,
                          persisted: learnedFacts,
                          versionId: persistResult.versionId,
                          categories: escalatedCategories,
                        },
                      });
                    } catch (e) {
                      logger.warn(
                        { err: e instanceof Error ? e.message : String(e) },
                        "Professor escalation audit write failed (non-blocking)",
                      );
                    }
                  } catch (err) {
                    logger.warn(
                      { err: err instanceof Error ? err.message : String(err) },
                      "SAMA Professor: fact persistence after send failed (non-blocking)",
                    );
                  }
                }

                await upsertConversationAiState({
                  tenantId: tenant.id,
                  conversationId,
                  status: "auto_sent",
                  draftBody: null,
                  draftSource,
                  confidence: replyConfidence,
                  queryCategory,
                  latestInboundMessageId: inboundMessageId,
                  inboundSid,
                  outboundMessageId: sent.messageRow.id,
                  autoSentAt: new Date(),
                });

                recordMessageUsage(tenant.id, tenantSlug).catch((e) =>
                  logger.warn(
                    { err: e, tenantId: tenant.id },
                    "Usage tracking failed (non-blocking)",
                  ),
                );
                eventBus.publish(tenant.id, {
                  type: "message:new",
                  conversationId,
                  direction: "outbound",
                });
                try {
                  await db.insert(auditLogsTable).values({
                    tenantId: tenant.id,
                    actorUserId: null,
                    actorEmail: "system:ai-student",
                    action: "ai.auto_replied",
                    entityType: "conversation",
                    entityId: String(conversationId),
                    afterJson: {
                      inboundSid,
                      messageId: sent.messageRow.id,
                      escalated,
                      learnedFacts,
                      confidence: replyConfidence,
                      queryCategory,
                      groundingCategories: escalated
                        ? escalatedCategories
                        : groundingCategories,
                    },
                  });
                } catch (e) {
                  logger.warn(
                    { err: e instanceof Error ? e.message : String(e) },
                    "AI auto-reply audit write failed (non-blocking)",
                  );
                }
                logger.info(
                  {
                    tenantSlug,
                    conversationId,
                    messageId: sent.messageRow.id,
                  },
                  "SAMA Auto-Pilot: AUTO-SENT reply",
                );
              } else {
                // Claimed but the send did not complete. The customer received
                // nothing, so RELEASE the claim (delete) so a webhook retry can
                // re-attempt. Blue handback (failed), no learn.
                await db
                  .delete(aiAutoRepliesTable)
                  .where(eq(aiAutoRepliesTable.id, claimed[0].id));
                claimFinalized = true;
                await upsertConversationAiState({
                  tenantId: tenant.id,
                  conversationId,
                  status: "failed",
                  draftBody: replyText.length > 0 ? replyText : null,
                  draftSource,
                  confidence: replyConfidence,
                  queryCategory,
                  reasonCode: "send_failed",
                  reasonText: describeHandbackReason(["send_failed"]),
                  latestInboundMessageId: inboundMessageId,
                  inboundSid,
                });
                eventBus.publish(tenant.id, {
                  type: "ai:state",
                  conversationId,
                });
                logger.error(
                  {
                    tenantSlug,
                    conversationId,
                    reason: sent.ok ? sent.status : sent.reason,
                  },
                  "SAMA Auto-Pilot: claimed but send failed; released claim, Blue handback",
                );
              }
            } catch (sendErr) {
              const sendErrMsg =
                sendErr instanceof Error ? sendErr.message : String(sendErr);
              if (!claimFinalized) {
                // The send threw before recording an outbound id, so the customer
                // received nothing. Release the (null) claim so a webhook/worker
                // retry can re-attempt, and hand back Blue for this turn —
                // consistent with the {ok:false} contract above. NOT re-thrown:
                // a send failure is a terminal handback, not a whole-burst retry.
                try {
                  await db
                    .delete(aiAutoRepliesTable)
                    .where(eq(aiAutoRepliesTable.id, claimed[0].id));
                } catch (releaseErr) {
                  logger.error(
                    {
                      tenantSlug,
                      conversationId,
                      err:
                        releaseErr instanceof Error
                          ? releaseErr.message
                          : String(releaseErr),
                    },
                    "SAMA Auto-Pilot: failed to release auto-send claim after send error",
                  );
                }
                try {
                  await upsertConversationAiState({
                    tenantId: tenant.id,
                    conversationId,
                    status: "failed",
                    draftBody: replyText.length > 0 ? replyText : null,
                    draftSource,
                    confidence: replyConfidence,
                    queryCategory,
                    reasonCode: "send_failed",
                    reasonText: describeHandbackReason(["send_failed"]),
                    latestInboundMessageId: inboundMessageId,
                    inboundSid,
                  });
                  eventBus.publish(tenant.id, {
                    type: "ai:state",
                    conversationId,
                  });
                } catch (stateErr) {
                  logger.error(
                    {
                      tenantSlug,
                      conversationId,
                      err:
                        stateErr instanceof Error
                          ? stateErr.message
                          : String(stateErr),
                    },
                    "SAMA Auto-Pilot: failed to write Blue handback after send error",
                  );
                }
                logger.error(
                  { tenantSlug, conversationId, err: sendErrMsg },
                  "SAMA Auto-Pilot: auto-send threw; released claim, Blue handback",
                );
              } else {
                // The reply already went out (claim is terminal); only post-send
                // bookkeeping failed. Leave the claim intact so retries stay
                // idempotent and the customer is never double-texted.
                logger.warn(
                  { tenantSlug, conversationId, err: sendErrMsg },
                  "SAMA Auto-Pilot: post-send step failed (non-blocking); reply already sent",
                );
              }
            }
          } else {
            // Another invocation already owns this SID. Treat as auto-sent only
            // if that one actually completed the send.
            const existing = await db
              .select({
                outboundMessageId: aiAutoRepliesTable.outboundMessageId,
              })
              .from(aiAutoRepliesTable)
              .where(
                and(
                  eq(aiAutoRepliesTable.tenantId, tenant.id),
                  eq(aiAutoRepliesTable.inboundSid, inboundSid),
                ),
              )
              .limit(1);
            if (existing[0]?.outboundMessageId != null) {
              autoSent = true;
              logger.info(
                { tenantSlug, conversationId },
                "SAMA Auto-Pilot: auto-send already completed (idempotent skip)",
              );
            }
          }
        } else if (!decision.autoSend) {
          // Gate refused → Blue handback for THIS message, no learn. Auto-send
          // the tenant's holding phrase (if configured) so the customer is acked
          // while a human owns the real reply.
          await maybeHandbackWithHoldingAck({
            tenant,
            tenantSlug,
            conversationId,
            inboundMessageId,
            inboundSid,
            fromNumber,
            status: "refused",
            draftBody: replyText.length > 0 ? replyText : null,
            draftSource,
            confidence: replyConfidence,
            queryCategory,
            reasonCode: decision.reasons[0] ?? "gate_refused",
            reasonText: describeHandbackReason(decision.reasons),
          });
          logger.info(
            {
              tenantSlug,
              conversationId,
              escalated,
              reasons: decision.reasons,
            },
            "SAMA Auto-Pilot: auto-send gated off; Blue handback",
          );
        }
      }
    }

    // Post to Chatwoot when configured: a PUBLIC mirror of an auto-sent reply,
    // else a PRIVATE whisper draft so Chatwoot-side agents always see an
    // accurate thread. (Gated only on tenant Chatwoot config — the inbound
    // forward already happened on the webhook's post-ack path.)
    if (tenant.chatwootAccountId && tenant.chatwootInboxId) {
      try {
        const post = await postChatwootMessage({
          accountId: tenant.chatwootAccountId,
          inboxId: tenant.chatwootInboxId,
          contactPhone: fromNumber,
          body: autoSent ? replyText : whisperToPost,
          messageType: "outgoing",
          private: !autoSent,
        });
        logger.info(
          {
            tenantSlug,
            whisperPost: post.status,
            autoSent,
            detail: post.detail,
          },
          autoSent
            ? "SAMA Student: mirrored auto-reply to Chatwoot"
            : "SAMA Student: posted Whisper to Chatwoot",
        );
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "SAMA Student: Chatwoot mirror failed (non-blocking)",
        );
      }
    }
  } catch (err) {
    // Unexpected pipeline failure. Every EXPECTED outcome — stub fallback, gate
    // refusal, send failure — is handled inline with a Blue handback above and
    // returns normally. Reaching here means the inbound could not be processed
    // at all, so RE-THROW: the inbound-AI worker's processOne requeues/dead-
    // letters the WHOLE coalesced burst instead of silently marking it done.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "SAMA AI: engagement pipeline failed",
    );
    throw err instanceof Error ? err : new Error(String(err));
  }
}
