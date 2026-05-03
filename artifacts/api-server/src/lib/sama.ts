import { logger } from "./logger";

export type InjectForwardResult = {
  status: "stubbed" | "sent" | "failed";
  responseSummary: string | null;
};

/**
 * Forward an injection payload to the configured n8n webhook.
 *
 * Behavior:
 * - If N8N_WEBHOOK_URL is not set, the call is STUBBED (no network call) — this
 *   is Gate 1 behavior so the Conductor can confirm internal plumbing first.
 * - If N8N_WEBHOOK_URL is set, the payload is POSTed to it (Gate 2: live wire).
 */
export async function forwardInjectionToN8n(payload: {
  to: string;
  body: string;
  tenantId: number | null;
  conductorAuthorized: boolean;
}): Promise<InjectForwardResult> {
  const url = process.env["N8N_WEBHOOK_URL"];

  const wirePayload = {
    to: payload.to,
    body: payload.body,
    metadata: {
      source: "Replit-App-Builder",
      conductor_authorized: payload.conductorAuthorized,
      tenant_id: payload.tenantId,
    },
  };

  if (!url) {
    logger.info(
      { to: payload.to, tenantId: payload.tenantId, mode: "stub" },
      "SAMA Injection: STUBBED (N8N_WEBHOOK_URL not set)",
    );
    return {
      status: "stubbed",
      responseSummary:
        "Stubbed: N8N_WEBHOOK_URL not configured — Gate 1 plumbing only",
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(wirePayload),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      logger.warn(
        { status: res.status, body: text.slice(0, 200) },
        "SAMA Injection: forwarding to n8n failed",
      );
      return {
        status: "failed",
        responseSummary: `n8n responded ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    logger.info(
      { status: res.status, to: payload.to },
      "SAMA Injection: forwarded to n8n",
    );
    return {
      status: "sent",
      responseSummary: `n8n ${res.status} ok${text ? `: ${text.slice(0, 200)}` : ""}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "SAMA Injection: forwarding error");
    return { status: "failed", responseSummary: `Error: ${message}` };
  }
}
