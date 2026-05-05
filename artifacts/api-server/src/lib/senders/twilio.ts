import type { Twilio } from "twilio";
import { logger } from "../logger";
import type { MessageSender, SendInput, SendResult } from "./types";

/**
 * Direct Twilio REST sender. No Fonoster, no SaaS middleman.
 * Future Fonoster sender will implement the same MessageSender interface.
 */
export class TwilioSender implements MessageSender {
  readonly name = "twilio-direct";

  constructor(
    private readonly client: Twilio,
    private readonly defaultFrom: string,
  ) {}

  /**
   * Compute the public URL Twilio should POST delivery status updates to.
   * Twilio rejects non-public URLs (localhost, .replit.dev preview, etc.),
   * so we only attach a callback when we have a real published domain. In
   * dev/preview, messages still send — we just won't see delivery / failure
   * codes (use `pnpm publish` to a Replit deployment to enable them).
   */
  private statusCallbackUrl(): string | undefined {
    const explicit = process.env["TWILIO_STATUS_CALLBACK_URL"];
    if (explicit) return explicit;
    const domains = process.env["REPLIT_DOMAINS"];
    if (!domains) return undefined;
    const first = domains.split(",")[0]?.trim();
    if (!first) return undefined;
    // Replit preview domains end with `.replit.dev`; only published
    // deployments end with `.replit.app` (or a custom domain). Twilio will
    // reject preview URLs, so skip the callback there.
    if (first.endsWith(".replit.dev")) return undefined;
    return `https://${first}/api/webhooks/twilio/status`;
  }

  async send(input: SendInput): Promise<SendResult> {
    const from = input.fromOverride ?? this.defaultFrom;
    const baseCallback = this.statusCallbackUrl();
    const statusCallback =
      baseCallback && input.messageId
        ? `${baseCallback}?msgId=${encodeURIComponent(String(input.messageId))}`
        : baseCallback;
    try {
      const msg = await this.client.messages.create({
        from,
        to: input.to,
        body: input.body,
        ...(statusCallback ? { statusCallback } : {}),
      });
      logger.info(
        {
          sid: msg.sid,
          status: msg.status,
          from,
          to: input.to,
          tenantId: input.tenantId,
          statusCallback: statusCallback ?? "(none — preview/local)",
        },
        "SAMA Injection: Twilio accepted message",
      );
      return {
        status: "sent",
        responseSummary: `Twilio sid=${msg.sid} status=${msg.status} from=${from}`,
        externalId: msg.sid,
      };
    } catch (err) {
      const e = err as { code?: number | string; message?: string };
      const summary = `Twilio ${e.code ?? "ERR"}: ${e.message ?? String(err)} (from=${from})`;
      logger.warn({ to: input.to, from, err: summary }, "SAMA Injection: Twilio rejected");
      return { status: "failed", responseSummary: summary, externalId: null };
    }
  }
}
