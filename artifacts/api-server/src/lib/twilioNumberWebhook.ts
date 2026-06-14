import twilio from "twilio";
import {
  getPublicWebhookConfig,
  type PublicWebhookConfig,
} from "./publicTwilioUrls";

type TwilioClient = ReturnType<typeof twilio>;

export type WebhookApplyResult =
  | { ok: true; sid: string }
  | { ok: false; reason: string };

/**
 * The ONE definition of the inbound webhook payload applied to a Twilio number.
 * Used by the update-based helpers below AND spread into the purchase
 * `incomingPhoneNumbers.create` call, so smsUrl/statusCallback can never drift
 * across the create / assign / repair paths.
 */
export function buildInboundWebhookParams(webhook: PublicWebhookConfig) {
  return {
    smsUrl: webhook.smsUrl,
    smsMethod: webhook.smsMethod,
    statusCallback: webhook.statusCallbackUrl,
    statusCallbackMethod: "POST" as const,
  };
}

/**
 * Point a Twilio number's inbound SMS webhook (and delivery status callback) at
 * our app, given the number's Twilio SID.
 *
 * This is the SINGLE definition of the inbound webhook payload. The purchase
 * flow sets it at create-time, the tenant department-assign sets it by SID, and
 * the admin primary-assign sets it via {@link applyInboundWebhookByNumber} — all
 * three go through here so the smsUrl/statusCallback can never drift apart.
 *
 * Callers treat the result as best-effort: the canonical `phone_numbers` registry
 * is the source of truth, and a webhook miss is repairable later via
 * `POST /phone-provisioning/repair-webhooks`.
 */
export async function applyInboundWebhookBySid(
  client: TwilioClient,
  sid: string,
): Promise<WebhookApplyResult> {
  const webhook = getPublicWebhookConfig();
  if (!webhook.available) {
    return { ok: false, reason: webhook.reason };
  }
  await client.incomingPhoneNumbers(sid).update(buildInboundWebhookParams(webhook));
  return { ok: true, sid };
}

/**
 * Same as {@link applyInboundWebhookBySid} but resolves the Twilio SID from the
 * E.164 number first. The admin primary-assign path only has the number (the
 * operator picks it from the owned-numbers list), not the SID.
 *
 * Returns `ok:false` when the connected Twilio account does not actually own the
 * number — that is the same 21660 guard the owned-numbers picker enforces, so a
 * mismatch here means the number was set directly rather than via the picker.
 */
export async function applyInboundWebhookByNumber(
  client: TwilioClient,
  phoneNumberE164: string,
): Promise<WebhookApplyResult> {
  const webhook = getPublicWebhookConfig();
  if (!webhook.available) {
    return { ok: false, reason: webhook.reason };
  }
  const matches = await client.incomingPhoneNumbers.list({
    phoneNumber: phoneNumberE164,
    limit: 1,
  });
  const found = matches[0];
  if (!found) {
    return {
      ok: false,
      reason: `Number ${phoneNumberE164} is not owned by the connected Twilio account.`,
    };
  }
  return applyInboundWebhookBySid(client, found.sid);
}
