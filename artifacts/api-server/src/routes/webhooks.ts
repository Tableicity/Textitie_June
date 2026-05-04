import { Router, type IRouter } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db, webhookEventsTable, tenantsTable, conversationsTable, messagesTable } from "@workspace/db";
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
import { logger } from "../lib/logger";

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

  // ---- Inbound Router (Gate 3) ----
  // Only Twilio inbound SMS gets routed; chatwoot/n8n events are recorded as-is.
  if (params.data.source === "twilio") {
    const toNumber = pickString(rawBody, ["To", "to"]);
    const fromNumber = pickString(rawBody, ["From", "from"]);
    const messageBody = pickString(rawBody, ["Body", "body"]) ?? "";

    if (toNumber) {
      const [tenant] = await db
        .select()
        .from(tenantsTable)
        .where(eq(tenantsTable.phoneNumber, toNumber));

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
          void (async () => {
            try {
              const existing = await db
                .select({ id: conversationsTable.id })
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
              if (existing.length > 0) {
                conversationId = existing[0].id;
              } else {
                const [newConv] = await db
                  .insert(conversationsTable)
                  .values({
                    tenantId: tenant.id,
                    contactPhone: fromNumber,
                    contactName: fromNumber,
                    status: "open",
                    lastMessageAt: new Date(),
                  })
                  .returning({ id: conversationsTable.id });
                conversationId = newConv.id;
              }

              await db.insert(messagesTable).values({
                conversationId,
                direction: "inbound",
                body: messageBody,
                senderName: fromNumber,
                read: false,
              });

              await db
                .update(conversationsTable)
                .set({ lastMessageAt: new Date() })
                .where(eq(conversationsTable.id, conversationId));

              const result = await processInboundMessage(
                tenant.id,
                conversationId,
                fromNumber,
                messageBody,
              );
              if (result.handled) {
                logger.info(
                  { tenantSlug: tenant.slug, from: fromNumber, action: result.action },
                  "Automation engine handled inbound message",
                );
              }

              // Phase 6 — Last-Touch Campaign Attribution (72h window).
              // Skip if this was an opt-out: those are attributed separately
              // inside the automation engine to keep response_count clean
              // (an opt-out is not a "response" for ROI purposes).
              if (result.action !== "tcpa_opt_out" && result.action !== "opted_out_ignored") {
                await attributeInboundResponse(tenant.id, fromNumber);
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
router.post("/webhooks/twilio/status", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const externalId = pickString(body, ["MessageSid", "messageSid", "sid"]);
  const status = pickString(body, ["MessageStatus", "messageStatus", "status"]);
  const errorCode = pickString(body, ["ErrorCode", "errorCode"]);
  const errorMessage = pickString(body, ["ErrorMessage", "errorMessage"]);

  if (!externalId || !status) {
    req.log.warn({ body }, "Twilio status webhook missing MessageSid or MessageStatus");
    res.status(200).json({ ok: true, skipped: "missing fields" });
    return;
  }

  try {
    const result = await processDeliveryStatus(externalId, status, errorCode, errorMessage);
    req.log.info({ externalId, status, ...result }, "Twilio delivery-status processed");
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err, externalId, status }, "Twilio delivery-status handler error");
    res.status(200).json({ ok: false, error: "internal" });
  }
});

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
