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
import { studentWhisper } from "@workspace/ai-student";
import {
  retrieveClassroomFacts,
  classifyQueryCategory,
  normalizeCategory,
  hasUnresolvedConflicts,
  retrieveLibraryContext,
  professorEscalate,
  persistEscalatedFacts,
  type FactCategory,
  type ProfessorEscalation,
} from "./knowledge";
import {
  resolveEffectiveEngagementMode,
  evaluateAutoSend,
  evaluateProfessorEscalationSend,
  describeHandbackReason,
} from "./engagementPolicy";
import {
  upsertConversationAiState,
  supersedeConversationAiState,
  finalizeCopilotDraftForInbound,
  stageCopilotDraftForInbound,
} from "./aiStateStore";
import { grokConfigured } from "./grokClient";
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

    // CO-PILOT and AUTO-PILOT both draft. Retrieve Classroom grounding.
    const queryCategory = classifyQueryCategory(messageBody);
    let facts: ClassroomFact[] = [];
    try {
      facts = await retrieveClassroomFacts(tenant.id, messageBody, {
        category: queryCategory,
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "SAMA Student: classroom retrieval failed, falling back to legacy KB",
      );
    }
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
        whisperPreview: draft.whisperBody.slice(0, 500),
      },
      "SAMA Student: draft ready",
    );

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
    if (
      grokConfigured() &&
      draft.status === "drafted" &&
      !draft.kbMatched
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
      // ============ AUTO-PILOT ============
      const groundingCategories = facts.map((f) => normalizeCategory(f.category));

      if (draft.status !== "drafted" && !escalated) {
        // Grok produced no usable draft → Blue handback (failed).
        await upsertConversationAiState({
          tenantId: tenant.id,
          conversationId,
          status: "failed",
          draftBody: null,
          confidence: draft.confidence,
          queryCategory,
          reasonCode: "grok_error",
          reasonText: describeHandbackReason(["grok_error"]),
          latestInboundMessageId: inboundMessageId,
          inboundSid,
        });
        eventBus.publish(tenant.id, { type: "ai:state", conversationId });
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
              grokConfigured: true,
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
              eventBus.publish(tenant.id, { type: "ai:state", conversationId });
              logger.error(
                {
                  tenantSlug,
                  conversationId,
                  reason: sent.ok ? sent.status : sent.reason,
                },
                "SAMA Auto-Pilot: claimed but send failed; released claim, Blue handback",
              );
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
          // Gate refused → Blue handback for THIS message, no learn.
          await upsertConversationAiState({
            tenantId: tenant.id,
            conversationId,
            status: "refused",
            draftBody: replyText.length > 0 ? replyText : null,
            draftSource,
            confidence: replyConfidence,
            queryCategory,
            reasonCode: decision.reasons[0] ?? "gate_refused",
            reasonText: describeHandbackReason(decision.reasons),
            latestInboundMessageId: inboundMessageId,
            inboundSid,
          });
          eventBus.publish(tenant.id, { type: "ai:state", conversationId });
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
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "SAMA AI: engagement pipeline failed",
    );
  }
}
