import { logger } from "./logger";
import { getSender, type SendResult } from "./senders";
import { postChatwootMessage, type ChatwootMessageResult } from "./chatwoot";
import type { Tenant } from "@workspace/db";

/**
 * Dispatch an injection through the active sender.
 *
 * Order of operations (Gate 3):
 *  1. If tenant has chatwoot_inbox_id → post a PRIVATE NOTE (Whisper) to
 *     Chatwoot first so the human agent sees what SAMA is about to send.
 *  2. Send via the active sender (Twilio direct), using the tenant's own
 *     phone_number as the From if available.
 *  3. If N8N_WEBHOOK_URL is set → fire a non-blocking notification.
 */
export async function dispatchInjection(payload: {
  to: string;
  body: string;
  tenant: Tenant | null;
  conductorAuthorized: boolean;
}): Promise<{ send: SendResult; whisper: ChatwootMessageResult | null }> {
  const { to, body, tenant, conductorAuthorized } = payload;
  const tenantId = tenant?.id ?? null;

  let whisper: ChatwootMessageResult | null = null;
  if (tenant?.chatwootAccountId && tenant?.chatwootInboxId) {
    whisper = await postChatwootMessage({
      accountId: tenant.chatwootAccountId,
      inboxId: tenant.chatwootInboxId,
      contactPhone: to,
      body: `[SAMA Whisper] About to send: ${body}`,
      messageType: "outgoing",
      private: true,
    });
    logger.info(
      { tenantId, whisper: whisper.status, detail: whisper.detail },
      "SAMA: posted Whisper to Chatwoot before send",
    );
  }

  const sender = getSender();
  const send = await sender.send({
    to,
    body,
    tenantId,
    conductorAuthorized,
    fromOverride: tenant?.phoneNumber ?? null,
  });

  const n8nUrl = process.env["N8N_WEBHOOK_URL"];
  if (n8nUrl) {
    void notifyN8n(n8nUrl, { to, body, tenantId }, send, sender.name).catch(
      (err) => {
        logger.warn({ err: String(err) }, "SAMA: n8n notify failed (non-fatal)");
      },
    );
  }

  return { send, whisper };
}

async function notifyN8n(
  url: string,
  payload: { to: string; body: string; tenantId: number | null },
  result: SendResult,
  senderName: string,
): Promise<void> {
  const wire = {
    to: payload.to,
    body: payload.body,
    metadata: {
      source: "Replit-SAMA-ControlPlane",
      sender: senderName,
      tenant_id: payload.tenantId,
      send_status: result.status,
      external_id: result.externalId,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(wire),
  });
  logger.info({ status: res.status, sender: senderName }, "SAMA: notified n8n");
}
