import { logger } from "../logger";
import type { MessageSender, SendInput, SendResult } from "./types";

/**
 * Stub sender — returns "stubbed" status with a synthetic externalId so that
 * downstream Sim-Vibe (the campaign engine) can replay a fake Twilio
 * delivery-status webhook for end-to-end testing without a live Twilio account.
 */
export class StubSender implements MessageSender {
  readonly name = "stub";

  async send(input: SendInput): Promise<SendResult> {
    const externalId = `STUB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    logger.info(
      { to: input.to, tenantId: input.tenantId, externalId },
      "SAMA Injection: STUBBED (Sim-Vibe — no live sender configured)",
    );
    return {
      status: "stubbed",
      responseSummary: `Stubbed: simulated delivery (external_id=${externalId})`,
      externalId,
    };
  }
}
