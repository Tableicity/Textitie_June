/**
 * SAMA send-notice catalog.
 *
 * Single source of truth for the customer/agent-facing copy shown when an
 * outbound send is BLOCKED by a billing/paywall gate. The Express API server
 * returns `{ error, reason }` on an HTTP 402; the React user-app reads the same
 * `reason` off the response body and renders the matching notice from this
 * catalog. Because BOTH sides import this one module, the wording can never
 * drift, and a new gate is added in exactly one place.
 *
 * Pure data only — no React, no Node, no I/O — so it is safe to import from a
 * browser bundle and a server process alike.
 */

/** Machine keys for every billing/paywall send-block reason. */
export type SendNoticeReason =
  | "paywall_new_contact"
  | "daily_trial_limit"
  | "trial_expired"
  | "credit_frozen";

/** Drives banner/toast styling on the client. */
export type SendNoticeSeverity = "info" | "warning" | "error";

export interface SendNoticeCta {
  /** Button label, e.g. "Upgrade". */
  label: string;
  /** Internal app route the CTA navigates to, e.g. "/billing". */
  href: string;
}

export interface SendNotice {
  /** Machine key — matches the `reason` field on the API 402 response body. */
  reason: SendNoticeReason;
  /** Short headline for a banner/toast title. */
  title: string;
  /** Full customer/agent-safe sentence. */
  message: string;
  /** Severity used for styling. */
  severity: SendNoticeSeverity;
  /** HTTP status the API returns for this reason. */
  httpStatus: number;
  /** Optional call to action (e.g. an Upgrade button). */
  cta?: SendNoticeCta;
}

const UPGRADE_CTA: SendNoticeCta = { label: "Upgrade", href: "/billing" };

/**
 * The catalog.
 *
 * The `message` strings MUST stay verbatim-identical to the historical server
 * constants (PAYWALL_NEW_CONTACT_MESSAGE, DAILY_TRIAL_LIMIT_MESSAGE,
 * TRIAL_EXPIRED_MESSAGE, CREDIT_FROZEN_MESSAGE), which now re-source their value
 * from here — several tests assert the exact wording.
 */
export const SEND_NOTICES: Record<SendNoticeReason, SendNotice> = {
  paywall_new_contact: {
    reason: "paywall_new_contact",
    title: "Paid plan required",
    message: "You will need a Paid Subscription to text New Contacts",
    severity: "warning",
    httpStatus: 402,
    cta: UPGRADE_CTA,
  },
  daily_trial_limit: {
    reason: "daily_trial_limit",
    title: "Daily trial limit reached",
    message:
      "Daily trial message limit reached. Upgrade to a paid plan or wait 24 hours to resume testing.",
    severity: "warning",
    httpStatus: 402,
    cta: UPGRADE_CTA,
  },
  trial_expired: {
    reason: "trial_expired",
    title: "Free trial ended",
    message:
      "Your free trial has ended. Upgrade to a paid plan to resume texting.",
    severity: "error",
    httpStatus: 402,
    cta: UPGRADE_CTA,
  },
  credit_frozen: {
    reason: "credit_frozen",
    title: "Out of credits",
    message:
      "This message can't be sent — your messaging credits are exhausted. Add credits or enable Backup auto-replenish to resume sending.",
    severity: "error",
    httpStatus: 402,
    cta: { label: "Add credits", href: "/billing" },
  },
};

/** All valid reason keys, in catalog declaration order. */
export const SEND_NOTICE_REASONS = Object.keys(
  SEND_NOTICES,
) as SendNoticeReason[];

/** Type guard: is an arbitrary value a known send-notice reason? */
export function isSendNoticeReason(
  reason: unknown,
): reason is SendNoticeReason {
  return typeof reason === "string" && reason in SEND_NOTICES;
}

/**
 * Tolerant lookup for an untyped wire value (e.g. the client reading
 * `err.data.reason` off a thrown ApiError). Returns `undefined` for
 * unknown/absent reasons so the caller can fall back to the server-sent
 * `error` string.
 */
export function getSendNotice(reason: unknown): SendNotice | undefined {
  return isSendNoticeReason(reason) ? SEND_NOTICES[reason] : undefined;
}
