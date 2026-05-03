import twilio from "twilio";
import { logger } from "../logger";
import { StubSender } from "./stub";
import { TwilioSender } from "./twilio";
import type { MessageSender } from "./types";

let cached: MessageSender | null = null;

/**
 * Pick the active sender based on environment.
 * Order: Twilio direct → stub.
 * Future: Fonoster (when SAMA_SENDER=fonoster and FONOSTER_* set).
 */
export function getSender(): MessageSender {
  if (cached) return cached;

  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const from = process.env["SAMA_FROM_NUMBER"];
  const explicit = process.env["SAMA_SENDER"];

  if (explicit === "stub") {
    logger.warn("SAMA: sender forced to STUB via SAMA_SENDER=stub");
    cached = new StubSender();
    return cached;
  }

  if (sid && token && from) {
    logger.info(
      { from, sender: "twilio-direct" },
      "SAMA: Twilio direct sender wired",
    );
    cached = new TwilioSender(twilio(sid, token), from);
    return cached;
  }

  logger.warn(
    "SAMA: no live sender credentials — falling back to stub. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SAMA_FROM_NUMBER to go live.",
  );
  cached = new StubSender();
  return cached;
}

export type { MessageSender, SendResult, SendInput, SendStatus } from "./types";
