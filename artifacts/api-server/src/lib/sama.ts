import { logger } from "./logger";
import { getSender, type SendResult } from "./senders";

/**
 * Dispatch an injection through the active sender (Twilio direct in Gate 2;
 * stub otherwise) and, if N8N_WEBHOOK_URL is set, fire a non-blocking
 * notification to n8n for downstream orchestration / logging.
 */
export async function dispatchInjection(payload: {
  to: string;
  body: string;
  tenantId: number | null;
  conductorAuthorized: boolean;
}): Promise<SendResult> {
  const sender = getSender();
  const result = await sender.send(payload);

  const n8nUrl = process.env["N8N_WEBHOOK_URL"];
  if (n8nUrl) {
    void notifyN8n(n8nUrl, payload, result, sender.name).catch((err) => {
      logger.warn({ err: String(err) }, "SAMA: n8n notify failed (non-fatal)");
    });
  }

  return result;
}

async function notifyN8n(
  url: string,
  payload: {
    to: string;
    body: string;
    tenantId: number | null;
    conductorAuthorized: boolean;
  },
  result: SendResult,
  senderName: string,
): Promise<void> {
  const wire = {
    to: payload.to,
    body: payload.body,
    metadata: {
      source: "Replit-SAMA-ControlPlane",
      sender: senderName,
      conductor_authorized: payload.conductorAuthorized,
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
  logger.info(
    { status: res.status, sender: senderName },
    "SAMA: notified n8n",
  );
}
