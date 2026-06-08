import { Router, type IRouter } from "express";
import { desc, eq, and, sql } from "drizzle-orm";
import { db, webhookEventsTable, tenantsTable, conversationsTable, messagesTable, contactsTable } from "@workspace/db";
import {
  ReceiveWebhookParams,
  ListWebhookEventsQueryParams,
  ListWebhookEventsResponse,
  ListWebhookEventsResponseItem,
} from "@workspace/api-zod";
import { postChatwootMessage } from "../lib/chatwoot";
import { studentWhisper } from "@workspace/ai-student";
import { processInboundMessage } from "../lib/automationEngine";
import { attributeInboundResponse } from "../lib/campaignAttribution";
import { processDeliveryStatus } from "../lib/deliveryStatus";
import { resolveTenantByPhoneNumber } from "../lib/tenantPhoneLookup";
import { eventBus } from "../lib/eventBus";
import { logger } from "../lib/logger";
import { checkTwilioSignature, requireTwilioSignature } from "../lib/twilioSignature";

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

    if (toNumber) {
      const tenant = await resolveTenantByPhoneNumber(toNumber);

      if (tenant) {
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

          // ---- AI Student Whisper (fire-and-forget) ----
          const studentTenant = tenant;
          const studentFrom = fromNumber;
          const studentBody = messageBody;
          const studentChatwoot = chatwootResult;
          void (async () => {
            try {
              const draft = await studentWhisper({
                tenant: studentTenant,
                fromNumber: studentFrom,
                inboundBody: studentBody,
              });
              logger.info(
                {
                  tenantSlug: studentTenant.slug,
                  status: draft.status,
                  latencyMs: draft.latencyMs,
                  detail: draft.detail,
                  whisperPreview: draft.whisperBody.slice(0, 500),
                },
                "SAMA Student: draft ready",
              );
              if (
                studentChatwoot.status === "sent" &&
                studentChatwoot.conversationId &&
                studentTenant.chatwootAccountId &&
                studentTenant.chatwootInboxId
              ) {
                const post = await postChatwootMessage({
                  accountId: studentTenant.chatwootAccountId,
                  inboxId: studentTenant.chatwootInboxId,
                  contactPhone: studentFrom,
                  body: draft.whisperBody,
                  messageType: "outgoing",
                  private: true,
                });
                logger.info(
                  {
                    tenantSlug: studentTenant.slug,
                    whisperPost: post.status,
                    detail: post.detail,
                  },
                  "SAMA Student: posted Whisper to Chatwoot",
                );
              }
            } catch (err) {
              logger.warn(
                { err: err instanceof Error ? err.message : String(err) },
                "SAMA Student: whisper pipeline failed",
              );
            }
          })();
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
                .returning({ id: contactsTable.id, name: contactsTable.name });
              const contactId = contact.id;
              const resolvedContactName = contact.name ?? fromNumber;

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

              await tdb.insert(messagesTable).values({
                conversationId,
                direction: "inbound",
                body: messageBody,
                senderName: resolvedContactName,
                read: false,
              });

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
