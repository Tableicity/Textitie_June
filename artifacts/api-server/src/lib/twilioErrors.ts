/**
 * Friendly messages for the most common Twilio SMS error codes.
 *
 * Twilio sometimes sends `ErrorCode` in the status callback without an
 * `ErrorMessage`, leaving the inbox UI showing a bare number like "30034"
 * that means nothing to an operator. We enrich those here with the
 * official short description so a human can act on it.
 *
 * Sources:
 *  - https://www.twilio.com/docs/api/errors
 *  - A2P 10DLC family: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api
 *
 * Keep this list focused on codes operators actually see — bloating it
 * with every Twilio error code makes the lookup useless.
 */
const TWILIO_ERROR_MESSAGES: Record<string, string> = {
  // ---- Generic delivery failures ----
  "30001": "Queue overflow — message held too long before sending",
  "30002": "Account suspended",
  "30003": "Unreachable destination handset",
  "30004": "Message blocked by recipient",
  "30005": "Unknown destination handset",
  "30006": "Landline or unreachable carrier",
  "30007": "Carrier filtered as spam",
  "30008": "Unknown delivery error",
  "30009": "Missing inbound segment",
  "30010": "Message price exceeds max price",

  // ---- US A2P 10DLC compliance (the big one for B2C SMS) ----
  "30032": "Toll-free number not yet verified",
  "30033": "US A2P 10DLC — daily message cap exceeded",
  "30034": "Carrier blocked: sender not registered for A2P 10DLC",
  "30035": "US A2P 10DLC — campaign suspended for high opt-out rate",
  "30036": "Message expired before delivery",
  "30038": "US A2P 10DLC — campaign throughput exceeded",

  // ---- Content / opt-out ----
  "30450": "Duplicate message detected by carrier",
  "30454": "Carrier rejected: message contains a public URL shortener",
  "30410": "Provider timeout",
  "21610": "Recipient has opted out (replied STOP)",
  "21611": "Outgoing message limit exceeded",
  "21612": "From number cannot send messages to destination",
  "21614": "Invalid mobile number",
};

/**
 * Build the human-readable error string we persist into
 * `messages.error_message` (and surface in the inbox UI).
 *
 * Precedence:
 *   1. `code: friendly description from Twilio + raw ErrorMessage` if both known
 *   2. `code: friendly description` if only code is known
 *   3. `code: ErrorMessage` if Twilio gave us a message but no mapping
 *   4. `Twilio status: <status>` as a last resort
 */
export function describeTwilioError(
  code: string | null | undefined,
  message: string | null | undefined,
  fallbackStatus: string,
): string {
  const friendly = code ? TWILIO_ERROR_MESSAGES[code] : undefined;

  if (code && friendly && message && message !== friendly) {
    return `${code}: ${friendly} (${message})`;
  }
  if (code && friendly) {
    return `${code}: ${friendly}`;
  }
  if (code && message) {
    return `${code}: ${message}`;
  }
  if (code) {
    return `Twilio error ${code}`;
  }
  if (message) {
    return message;
  }
  return `Twilio status: ${fallbackStatus}`;
}
