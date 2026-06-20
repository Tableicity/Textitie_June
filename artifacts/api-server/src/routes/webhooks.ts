import { Router, type IRouter } from "express";
import { desc, eq, and, sql } from "drizzle-orm";
import { db, webhookEventsTable, tenantsTable, conversationsTable, messagesTable, contactsTable, auditLogsTable, aiAutoRepliesTable, type ClassroomFact } from "@workspace/db";
import {
  ReceiveWebhookParams,
  ListWebhookEventsQueryParams,
  ListWebhookEventsResponse,
  ListWebhookEventsResponseItem,
} from "@workspace/api-zod";
import { postChatwootMessage } from "../lib/chatwoot";
import { studentWhisper } from "@workspace/ai-student";
import {
  retrieveClassroomFacts,
  classifyQueryCategory,
  normalizeCategory,
  hasUnresolvedConflicts,
  retrieveLibraryContext,
  professorEscalate,
  persistEscalatedFacts,
  claimEscalationSlot,
  type FactCategory,
  type ProfessorEscalation,
} from "../lib/knowledge";
import {
  resolveEffectiveEngagementMode,
  evaluateAutoSend,
  evaluateProfessorEscalationSend,
  describeHandbackReason,
} from "../lib/engagementPolicy";
import {
  upsertConversationAiState,
  supersedeConversationAiState,
} from "../lib/aiStateStore";
import { grokConfigured } from "../lib/grokClient";
import { sendConversationReply } from "../lib/outboundReply";
import { processInboundMessage } from "../lib/automationEngine";
import { attributeInboundResponse } from "../lib/campaignAttribution";
import { processDeliveryStatus } from "../lib/deliveryStatus";
import { resolveTenantByPhoneNumber } from "../lib/tenantPhoneLookup";
import { eventBus } from "../lib/eventBus";
import { logger } from "../lib/logger";
import { checkTwilioSignature, requireTwilioSignature } from "../lib/twilioSignature";
import { enqueueSync } from "../lib/integrations/syncWorker";
import { isBlocked, checkOutboundCompliance } from "../lib/compliance";
import { recordMessageUsage } from "../lib/stripe-stub";

const router: IRouter = Router();

router.post("/webhooks/:source", async (req, res): Promise<void> => {
  const params = ReceiveWebhookParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Twilio sends form-urlencoded by default; both shapes land here as objects.
  const rawBody =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};

  let payload: Record<string, unknown> = rawBody;

  // ---- Twilio signature gate ----
  // Inbound SMS is the only path where a public attacker can usefully forge
  // a request — they can spoof inbound texts, trigger AI replies on a
  // tenant's dime, and pollute conversation history. We can't apply
  // requireTwilioSignature() as middleware because chatwoot/n8n share this
  // route, so gate inline once the source is known.
  if (params.data.source === "twilio") {
    const sig = checkTwilioSignature(req);
    if (!sig.ok) {
      const error =
        sig.reason === "missing-header"
          ? "Missing Twilio signature"
          : "Invalid Twilio signature";
      res.status(sig.status).json({ error });
      return;
    }
  }

  // ---- Inbound Router (Gate 3) ----
  // Only Twilio inbound SMS gets routed; chatwoot/n8n events are recorded as-is.
  if (params.data.source === "twilio") {
    const toNumber = pickString(rawBody, ["To", "to"]);
    const fromNumber = pickString(rawBody, ["From", "from"]);
    const messageBody = pickString(rawBody, ["Body", "body"]) ?? "";
    // Sender display name, when the channel provides one. Twilio WhatsApp/RCS
    // send `ProfileName`; other bridges may use generic name keys. We fall back
    // to the raw phone number when none is present so the contact is never blank.
    const senderDisplayName = pickString(rawBody, [
      "ProfileName",
      "profileName",
      "SenderName",
      "senderName",
      "ContactName",
      "contactName",
      "Author",
      "author",
    ]);
    // Carrier MessageSid of THIS inbound text — the idempotency key for the B4
    // auto-reply claim. Twilio uses MessageSid (and the legacy SmsSid/
    // SmsMessageSid aliases). Absent for non-Twilio bridges → no auto-send.
    const inboundSid = pickString(rawBody, [
      "MessageSid",
      "messageSid",
      "SmsMessageSid",
      "SmsSid",
      "sid",
    ]);

    if (toNumber) {
      const tenant = await resolveTenantByPhoneNumber(toNumber);

      // ---- Block enforcement (inbound) ----
      // A tenant can "Block" a contact from the inbox contact card. Outbound
      // sends to a blocked number are already rejected in
      // checkOutboundCompliance; here we honor the same block on the way in.
      // A blocked number's text must never reach an agent, so we drop it
      // entirely — no Chatwoot forward, no AI whisper, no conversation
      // create/update, no realtime push, no automation/attribution. We still
      // record a tenant-scoped audit-log entry (and the raw webhook event
      // below) so there is a trail of the suppressed inbound for compliance.
      const senderBlocked =
        tenant != null && fromNumber != null
          ? await isBlocked(tenant.slug, tenant.id, fromNumber)
          : false;

      if (tenant && senderBlocked) {
        try {
          await db.insert(auditLogsTable).values({
            tenantId: tenant.id,
            actorUserId: null,
            actorEmail: "system:inbound-webhook",
            action: "inbound.blocked",
            entityType: "contact",
            entityId: fromNumber ?? "",
            afterJson: {
              phone: fromNumber,
              bodyPreview: messageBody.slice(0, 500),
              source: "inbound-webhook",
            },
          });
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), from: fromNumber },
            "Inbound block: audit log write failed (non-blocking)",
          );
        }
        req.log.info(
          { tenantSlug: tenant.slug, from: fromNumber },
          "SAMA Inbound Router: dropped message from blocked sender",
        );
        payload = {
          ...rawBody,
          _sama: {
            routed: false,
            blocked: true,
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            reason: "sender is blocked for this tenant",
          },
        };
      } else if (tenant) {
        let chatwootResult = null;
        if (tenant.chatwootAccountId && tenant.chatwootInboxId && fromNumber) {
          chatwootResult = await postChatwootMessage({
            accountId: tenant.chatwootAccountId,
            inboxId: tenant.chatwootInboxId,
            contactPhone: fromNumber,
            body: messageBody,
            messageType: "incoming",
            private: false,
          });
          req.log.info(
            {
              tenantSlug: tenant.slug,
              from: fromNumber,
              chatwoot: chatwootResult.status,
              detail: chatwootResult.detail,
            },
            "SAMA Inbound Router: forwarded to Chatwoot",
          );
        } else {
          req.log.info(
            {
              tenantSlug: tenant.slug,
              from: fromNumber,
              reason: "tenant has no Chatwoot inbox configured",
            },
            "SAMA Inbound Router: matched tenant but Chatwoot not wired",
          );
        }

        // ---- Automation Engine (Phase 5) ----
        if (fromNumber) {
          // Stage 4 cleanup: write inbound messages through the global `db`
          // (public.* with explicit tenantId) so the read path in
          // routes/conversations.ts and the write path in this webhook see
          // the same rows. Per-tenant schemas are deferred until we actually
          // need cross-customer isolation at the DB level.
          const tdb = db;
          const tenantSlug = tenant.slug;
          void (async () => {
            try {
              // ---- Auto-save inbound texter as a contact ----
              // Upsert a tenant-scoped contact keyed on E.164 phone so every
              // new texter lands in the address book without a manual save.
              // Repeat texters hit the unique (tenant_id, phone) index and
              // only bump last_interaction_at — no duplicate rows.
              // When the channel gives us a real display name, populate the
              // contact's name. On repeat texters we only fill a blank name
              // (COALESCE keeps any name an agent already edited) — we never
              // clobber a curated name with a profile name.
              const now = new Date();
              const updateSet: Record<string, unknown> = {
                lastInteractionAt: now,
                updatedAt: now,
              };
              if (senderDisplayName) {
                updateSet["name"] = sql`coalesce(${contactsTable.name}, ${senderDisplayName})`;
              }
              const [contact] = await tdb
                .insert(contactsTable)
                .values({
                  tenantId: tenant.id,
                  phone: fromNumber,
                  name: senderDisplayName,
                  firstSeenAt: now,
                  lastInteractionAt: now,
                })
                .onConflictDoUpdate({
                  target: [contactsTable.tenantId, contactsTable.phone],
                  set: updateSet,
                })
                // `xmax = 0` is true only for a freshly INSERTed row; an
                // ON CONFLICT UPDATE (repeat texter) sets xmax non-zero. This
                // lets us tell brand-new contacts from returning ones in a
                // single round-trip, so we only sync/audit once per contact.
                .returning({
                  id: contactsTable.id,
                  name: contactsTable.name,
                  inserted: sql<boolean>`(xmax = 0)`,
                });
              const contactId = contact.id;
              const resolvedContactName = contact.name ?? fromNumber;

              // Only newly auto-saved texters get pushed to a connected CRM and
              // audited — repeat texters just bumped last_interaction_at above
              // and must not be re-synced on every inbound message.
              if (contact.inserted) {
                try {
                  // enqueueSync no-ops when no CRM is connected for the tenant,
                  // mirroring the manual POST /contacts create path.
                  await enqueueSync({
                    tenantId: tenant.id,
                    tenantSlug,
                    provider: "hubspot",
                    entityType: "contact",
                    entityId: contactId,
                    op: "upsert",
                    payload: {
                      phone: fromNumber,
                      email: null,
                      firstName: null,
                      lastName: null,
                      tags: [],
                    },
                  });
                  await tdb.insert(auditLogsTable).values({
                    tenantId: tenant.id,
                    actorUserId: null,
                    actorEmail: "system:inbound-webhook",
                    action: "contact.created",
                    entityType: "contact",
                    entityId: String(contactId),
                    afterJson: { phone: fromNumber, source: "inbound-webhook" },
                  });
                } catch (err) {
                  logger.warn(
                    { err: err instanceof Error ? err.message : String(err), contactId },
                    "Auto-save contact CRM sync/audit failed (non-blocking)",
                  );
                }
              }

              const existing = await tdb
                .select({
                  id: conversationsTable.id,
                  contactId: conversationsTable.contactId,
                  contactName: conversationsTable.contactName,
                })
                .from(conversationsTable)
                .where(
                  and(
                    eq(conversationsTable.tenantId, tenant.id),
                    eq(conversationsTable.contactPhone, fromNumber),
                    eq(conversationsTable.status, "open"),
                  ),
                )
                .limit(1);

              let conversationId: number;
              let isNewConversation = false;
              if (existing.length > 0) {
                conversationId = existing[0].id;
                // Backfill contactId on pre-existing conversations created
                // before auto-save so name edits flow through the contact.
                // Also fill in a display name when the conversation only ever
                // showed the raw phone number — but leave any real name alone.
                const convUpdate: Record<string, unknown> = {};
                if (existing[0].contactId == null) {
                  convUpdate["contactId"] = contactId;
                }
                if (
                  senderDisplayName &&
                  (existing[0].contactName == null ||
                    existing[0].contactName === fromNumber)
                ) {
                  convUpdate["contactName"] = resolvedContactName;
                }
                if (Object.keys(convUpdate).length > 0) {
                  await tdb
                    .update(conversationsTable)
                    .set(convUpdate)
                    .where(eq(conversationsTable.id, conversationId));
                }
              } else {
                const [newConv] = await tdb
                  .insert(conversationsTable)
                  .values({
                    tenantId: tenant.id,
                    contactId,
                    contactPhone: fromNumber,
                    contactName: resolvedContactName,
                    status: "open",
                    lastMessageAt: new Date(),
                  })
                  .returning({ id: conversationsTable.id });
                conversationId = newConv.id;
                isNewConversation = true;
              }

              const [inboundMessageRow] = await tdb
                .insert(messagesTable)
                .values({
                  conversationId,
                  direction: "inbound",
                  body: messageBody,
                  senderName: resolvedContactName,
                  read: false,
                })
                .returning({ id: messagesTable.id });
              const inboundMessageId = inboundMessageRow?.id ?? null;

              await tdb
                .update(conversationsTable)
                .set({ lastMessageAt: new Date() })
                .where(eq(conversationsTable.id, conversationId));

              // Real-time push to any agent inbox watching this tenant.
              if (isNewConversation) {
                eventBus.publish(tenant.id, { type: "conversation:new", conversationId });
              }
              eventBus.publish(tenant.id, {
                type: "message:new",
                conversationId,
                direction: "inbound",
              });

              const result = await processInboundMessage(
                tenant.id,
                tenantSlug,
                conversationId,
                fromNumber,
                messageBody,
              );
              if (result.handled) {
                logger.info(
                  { tenantSlug, from: fromNumber, action: result.action },
                  "Automation engine handled inbound message",
                );
              }

              if (result.action !== "tcpa_opt_out" && result.action !== "opted_out_ignored") {
                await attributeInboundResponse(tenant.id, tenantSlug, fromNumber);
              }

              // ---- AI engagement pipeline (Manual / Co-Pilot / Auto-Pilot) ----
              // Runs here in the ordered durable pipeline, AFTER the automation
              // engine, so we never reply on top of an automation/opt-out, the
              // conversation+inbound rows already exist, and any auto-send latency
              // is off the inbound 200 path. Self-contained try/catch so an AI
              // failure never disturbs the durable writes above. Effective mode is
              // the per-conversation override ?? the tenant default.
              try {
                const overrideRow = await tdb
                  .select({ override: conversationsTable.engagementModeOverride })
                  .from(conversationsTable)
                  .where(eq(conversationsTable.id, conversationId))
                  .limit(1);
                const engagementMode = resolveEffectiveEngagementMode(
                  overrideRow[0]?.override ?? null,
                  tenant.engagementMode,
                );

                // MANUAL → AI fully off (no draft/send/learn). AUTOMATION-HANDLED →
                // the engine already replied. Either way: supersede any prior AI
                // state and skip the AI entirely.
                if (engagementMode === "manual" || result.handled) {
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
                      automationHandled: result.handled,
                    },
                    "SAMA AI: skipped (manual mode or automation handled); state superseded",
                  );
                } else {
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
                  // When the Student is ungrounded, the Professor answers from the
                  // Library + its expertise: a better DRAFT now, and (Auto-Pilot
                  // only, AFTER a confirmed verbatim auto-send) the facts we LEARN.
                  // We DELIBERATELY do not persist here — learning is gated on an
                  // autonomous, unedited send (the unifying learning rule). The
                  // customer's text is UNTRUSTED — a question, never truth.
                  let escalation: ProfessorEscalation | null = null;
                  let escalatedCategories: FactCategory[] = [];
                  if (
                    grokConfigured() &&
                    draft.status === "drafted" &&
                    !draft.kbMatched &&
                    claimEscalationSlot(tenant.id, messageBody)
                  ) {
                    try {
                      const lib = await retrieveLibraryContext(tenant.id, messageBody);
                      const libraryContext = lib
                        .map((c) => c.text)
                        .join("\n\n")
                        .slice(0, 8000);
                      escalation = await professorEscalate({
                        tenantName: tenant.name,
                        libraryContext,
                        question: messageBody,
                      });
                      escalatedCategories = Array.from(
                        new Set(
                          escalation.facts.map((f) => normalizeCategory(f.category)),
                        ),
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

                  // The Professor answer supersedes the Student draft as the reply
                  // when it produced screened facts AND a customer reply.
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
                  // Draft into the composer for a human to edit + send. NEVER
                  // auto-sends and NEVER learns.
                  if (engagementMode === "copilot") {
                    await upsertConversationAiState({
                      tenantId: tenant.id,
                      conversationId,
                      status: "drafted",
                      draftBody: replyText.length > 0 ? replyText : null,
                      draftSource,
                      confidence: replyConfidence,
                      queryCategory,
                      latestInboundMessageId: inboundMessageId,
                      inboundSid,
                    });
                    eventBus.publish(tenant.id, { type: "ai:state", conversationId });
                    logger.info(
                      {
                        tenantSlug,
                        conversationId,
                        draftSource,
                        hasDraft: replyText.length > 0,
                      },
                      "SAMA Co-Pilot: draft staged for human review",
                    );
                  } else {
                    // ============ AUTO-PILOT ============
                    const groundingCategories = facts.map((f) =>
                      normalizeCategory(f.category),
                    );

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
                      // Conflict check spans the answer's categories PLUS the
                      // always-sensitive pricing/compliance ones and the query
                      // intent. Compliance is re-checked at send time too.
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
                        hasConflict = await hasUnresolvedConflicts(
                          tenant.id,
                          conflictCats,
                        );
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
                            automationHandled: result.handled,
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
                        // Idempotency: claim the inbound SID before sending. The
                        // unique (tenant_id, inbound_sid) index lets exactly one
                        // caller win, so a webhook retry can never double-send.
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
                            await tdb
                              .update(conversationsTable)
                              .set({ lastMessageAt: new Date() })
                              .where(eq(conversationsTable.id, conversationId));

                            // ---- LEARN (only here) ----
                            // The reply went out autonomously and verbatim, so
                            // persist the Professor's screened facts as Classroom
                            // truth (so we never ask twice). No human-touch path
                            // ever reaches this line.
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
                                  await tdb.insert(auditLogsTable).values({
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
                              await tdb.insert(auditLogsTable).values({
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
                            // Claimed but the send did not complete. The customer
                            // received nothing, so RELEASE the claim (delete) so a
                            // webhook retry can re-attempt. Blue handback (failed),
                            // no learn.
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
                          // Another invocation already owns this SID. Treat as
                          // auto-sent only if that one actually completed the send.
                          const existing = await db
                            .select({
                              outboundMessageId:
                                aiAutoRepliesTable.outboundMessageId,
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

                  // Post to Chatwoot when configured: a PUBLIC mirror of an
                  // auto-sent reply, else a PRIVATE whisper draft so Chatwoot-side
                  // agents always see an accurate thread.
                  if (
                    chatwootResult &&
                    chatwootResult.status === "sent" &&
                    chatwootResult.conversationId &&
                    tenant.chatwootAccountId &&
                    tenant.chatwootInboxId
                  ) {
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
                  }
                }
              } catch (err) {
                logger.warn(
                  { err: err instanceof Error ? err.message : String(err) },
                  "SAMA AI: engagement pipeline failed",
                );
              }
            } catch (err) {
              logger.warn(
                { err: err instanceof Error ? err.message : String(err) },
                "Automation engine pipeline failed (non-fatal)",
              );
            }
          })();
        }

        payload = {
          ...rawBody,
          _sama: {
            routed: true,
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            chatwoot: chatwootResult
              ? {
                  status: chatwootResult.status,
                  conversationId: chatwootResult.conversationId,
                  messageId: chatwootResult.messageId,
                  detail: chatwootResult.detail,
                }
              : { status: "skipped", detail: "no chatwoot ids on tenant" },
          },
        };
      } else {
        req.log.warn(
          { to: toNumber, from: fromNumber },
          "SAMA Inbound Router: UNASSIGNED LEAD — no tenant owns this number",
        );
        payload = {
          ...rawBody,
          _sama: {
            routed: false,
            unassignedLead: true,
            reason: `No tenant matches To=${toNumber}`,
          },
        };
      }
    }
  }

  const [row] = await db
    .insert(webhookEventsTable)
    .values({
      source: params.data.source,
      payload,
    })
    .returning();
  req.log.info(
    { source: params.data.source, eventId: row?.id },
    `SAMA Webhook: recorded from ${params.data.source}`,
  );
  res.status(201).json(ListWebhookEventsResponseItem.parse(row));
});

/**
 * Twilio delivery-status callback. Twilio POSTs here with MessageSid +
 * MessageStatus when a message moves through the carrier (sent → delivered or
 * undelivered/failed). The Sim-Vibe path also calls this in-process so the
 * dashboard counters move during local testing without a live Twilio account.
 *
 * Always returns 200 — Twilio retries non-2xx responses aggressively.
 */
router.post(
  "/webhooks/twilio/status",
  requireTwilioSignature(),
  async (req, res): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const externalId = pickString(body, ["MessageSid", "messageSid", "sid"]);
    const status = pickString(body, ["MessageStatus", "messageStatus", "status"]);
    const errorCode = pickString(body, ["ErrorCode", "errorCode"]);
    const errorMessage = pickString(body, ["ErrorMessage", "errorMessage"]);

    // `?msgId=` is appended by TwilioSender so we can update by PK and avoid
    // the race where the callback arrives before externalId is persisted.
    const msgIdRaw = req.query["msgId"];
    const msgId =
      typeof msgIdRaw === "string" && /^\d+$/.test(msgIdRaw)
        ? Number(msgIdRaw)
        : undefined;

    if ((!externalId && !msgId) || !status) {
      req.log.warn({ body, msgId }, "Twilio status webhook missing identifiers or status");
      res.status(200).json({ ok: true, skipped: "missing fields" });
      return;
    }

    try {
      const result = await processDeliveryStatus(
        externalId ?? "",
        status,
        errorCode,
        errorMessage,
        msgId,
      );
      req.log.info({ externalId, msgId, status, ...result }, "Twilio delivery-status processed");
      res.status(200).json({ ok: true, ...result });
    } catch (err) {
      req.log.error({ err, externalId, msgId, status }, "Twilio delivery-status handler error");
      res.status(200).json({ ok: false, error: "internal" });
    }
  },
);

router.get("/webhook-events", async (req, res): Promise<void> => {
  const query = ListWebhookEventsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const limit = query.data.limit ?? 50;
  const rows = await db
    .select()
    .from(webhookEventsTable)
    .orderBy(desc(webhookEventsTable.createdAt))
    .limit(limit);
  res.json(ListWebhookEventsResponse.parse(rows));
});

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export default router;
