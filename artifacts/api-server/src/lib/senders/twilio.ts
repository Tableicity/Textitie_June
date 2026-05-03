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
    private readonly fromNumber: string,
  ) {}

  async send(input: SendInput): Promise<SendResult> {
    try {
      const msg = await this.client.messages.create({
        from: this.fromNumber,
        to: input.to,
        body: input.body,
      });
      logger.info(
        {
          sid: msg.sid,
          status: msg.status,
          to: input.to,
          tenantId: input.tenantId,
        },
        "SAMA Injection: Twilio accepted message",
      );
      return {
        status: "sent",
        responseSummary: `Twilio sid=${msg.sid} status=${msg.status}`,
        externalId: msg.sid,
      };
    } catch (err) {
      const e = err as { code?: number | string; message?: string };
      const summary = `Twilio ${e.code ?? "ERR"}: ${e.message ?? String(err)}`;
      logger.warn({ to: input.to, err: summary }, "SAMA Injection: Twilio rejected");
      return { status: "failed", responseSummary: summary, externalId: null };
    }
  }
}
