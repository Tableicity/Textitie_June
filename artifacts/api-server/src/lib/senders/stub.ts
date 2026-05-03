import { logger } from "../logger";
import type { MessageSender, SendInput, SendResult } from "./types";

export class StubSender implements MessageSender {
  readonly name = "stub";

  async send(input: SendInput): Promise<SendResult> {
    logger.info(
      { to: input.to, tenantId: input.tenantId },
      "SAMA Injection: STUBBED (no live sender configured)",
    );
    return {
      status: "stubbed",
      responseSummary:
        "Stubbed: no live sender (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SAMA_FROM_NUMBER)",
      externalId: null,
    };
  }
}
