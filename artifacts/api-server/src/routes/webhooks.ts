import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, webhookEventsTable, tenantsTable } from "@workspace/db";
import {
  ReceiveWebhookParams,
  ListWebhookEventsQueryParams,
  ListWebhookEventsResponse,
  ListWebhookEventsResponseItem,
} from "@workspace/api-zod";
import { postChatwootMessage } from "../lib/chatwoot";
import { studentWhisper } from "@workspace/ai-student";
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
          // Twilio's webhook gets a fast 201 even if the LLM takes a moment.
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
