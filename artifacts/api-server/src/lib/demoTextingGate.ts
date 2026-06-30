import { db, tenantsTable, tenantUsersTable, creditLedgerTable } from "@workspace/db";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { normalizePhoneE164 } from "./phoneNumberRegistry";
import { calculateMessageCredits } from "./messageCost";

/**
 * Demo paywall policy.
 *
 * A new tenant lands in a "Demo Department" and the operator assigns it a Demo
 * Number purely for testing. Until that tenant is on a real paid subscription it
 * may ONLY text the phone number it signed up with (the owner tenant_user's
 * phone). Texting any other contact is blocked.
 *
 * "Unlocked"/paid is defined narrowly as subscriptionStatus === "active". A trial
 * ("trialing"), "none", "past_due", or "canceled" tenant stays gated — the gate
 * covers the demo/testing phase that precedes an actual paid subscription. An
 * operator can also flip the per-tenant `billingBypass` ("Auto Approve / Auto
 * Subscribed") flag from the Conductor to treat a tenant as paid and bypass this
 * gate for testing the paid experience without going through the payment gateway.
 *
 * Enforcement lives in the single outbound source of truth
 * (`sendConversationReply`) so every send path (human composer, AI auto-send,
 * campaigns) is covered uniformly; an operator can assign a real demo From
 * number, so the From-ownership guard alone is not sufficient to gate this.
 */

export const PAYWALL_NEW_CONTACT_MESSAGE =
  "You will need a Paid Subscription to text New Contacts";

/**
 * A tenant can text any compliant contact once its subscription is active OR an
 * operator has flipped the per-tenant `billingBypass` ("Auto Approve / Auto
 * Subscribed") override on — the bypass treats the tenant as a paid subscriber
 * for testing without going through the payment gateway.
 */
export function isTextingUnlocked(
  subscriptionStatus: string | null | undefined,
  billingBypass?: boolean | null,
): boolean {
  return billingBypass === true || subscriptionStatus === "active";
}

/**
 * Canonicalize a phone for equality comparison. Prefers E.164 (matching how
 * signup stores the owner phone); since `normalizePhoneE164` throws on garbage,
 * fall back to a tolerant last-10-digits suffix so a malformed contact number
 * can never crash the send path — it simply won't match the signup phone.
 */
export function normalizeDemoPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  try {
    const e164 = normalizePhoneE164(phone);
    if (e164) return e164;
  } catch {
    // fall through to the tolerant digits-suffix comparison
  }
  const digits = phone.replace(/\D/g, "");
  return digits ? digits.slice(-10) : "";
}

/**
 * Pure policy. Returns true when an outbound to `contactPhone` must be BLOCKED
 * because the tenant is unpaid and the destination is not its signup phone.
 * Fails CLOSED: an unpaid tenant with no known allowed phone is fully blocked.
 */
export function isDemoTextingBlocked(args: {
  subscriptionStatus: string | null | undefined;
  allowedPhone: string | null | undefined;
  contactPhone: string | null | undefined;
  billingBypass?: boolean | null;
}): boolean {
  if (isTextingUnlocked(args.subscriptionStatus, args.billingBypass)) return false;
  const allowed = normalizeDemoPhone(args.allowedPhone);
  if (!allowed) return true; // unpaid + unknown signup phone => fail closed
  return normalizeDemoPhone(args.contactPhone) !== allowed;
}

/**
 * The phone a tenant signed up with = its owner tenant_user's phone. Picks the
 * oldest owner that has a phone, falling back to the oldest user with a phone so
 * a legacy tenant lacking an explicit "owner" role still resolves an allowed
 * phone. Multiple owners never widen access — only one phone is allowed.
 */
export async function loadOwnerSignupPhone(
  tenantId: number,
): Promise<string | null> {
  const users = await db
    .select({
      id: tenantUsersTable.id,
      role: tenantUsersTable.role,
      phone: tenantUsersTable.phone,
    })
    .from(tenantUsersTable)
    .where(eq(tenantUsersTable.tenantId, tenantId))
    .orderBy(asc(tenantUsersTable.id));
  const owner = users.find((u) => u.role === "owner" && u.phone);
  if (owner?.phone) return owner.phone;
  return users.find((u) => u.phone)?.phone ?? null;
}

/**
 * Send-time gate for the authoritative outbound path. Loads the tenant's
 * subscription status first; only when it is NOT active does it resolve the
 * allowed signup phone and compare. Active tenants pay just one tiny PK lookup.
 */
export async function isDemoTextingBlockedForTenant(
  tenantId: number,
  contactPhone: string,
): Promise<boolean> {
  const [tenant] = await db
    .select({
      subscriptionStatus: tenantsTable.subscriptionStatus,
      billingBypass: tenantsTable.billingBypass,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  const subscriptionStatus = tenant?.subscriptionStatus ?? null;
  const billingBypass = tenant?.billingBypass ?? false;
  if (isTextingUnlocked(subscriptionStatus, billingBypass)) return false;
  const allowedPhone = await loadOwnerSignupPhone(tenantId);
  return isDemoTextingBlocked({
    subscriptionStatus,
    allowedPhone,
    contactPhone,
    billingBypass,
  });
}

// ---------------------------------------------------------------------------
// Daily free-trial outbound budget.
//
// A tenant on the free trial (`subscriptionStatus === "trialing"`) may send at
// most TRIAL_DAILY_SEGMENT_CAP outbound SMS segments per ROLLING 24h — even
// when texting only its own signup number. Segments are measured in the same
// unit the credit ledger records (1 credit/segment for SMS, a flat 3 for MMS),
// so the prior-usage SUM and the pending message's cost are directly
// comparable. Active / billing-bypassed tenants are never capped; expired/none
// tenants are already restricted to self-texting by the contact gate above and
// are intentionally NOT subject to this trial-only budget.
// ---------------------------------------------------------------------------

/** Max outbound segments a trialing tenant may send per rolling 24h. */
export const TRIAL_DAILY_SEGMENT_CAP = 15;

export const DAILY_TRIAL_LIMIT_MESSAGE =
  "Daily trial message limit reached. Upgrade to a paid plan or wait 24 hours to resume testing.";

export type DemoGateReason = "paywall_new_contact" | "daily_trial_limit";

export interface DemoGateDecision {
  blocked: boolean;
  reason?: DemoGateReason;
  message?: string;
}

/**
 * Pure budget policy. Trial-only: returns true when sending `pendingSegments`
 * on top of `priorSegments24h` already used would push the tenant OVER the
 * daily cap. Unlocked tenants and non-trialing statuses are never capped.
 */
export function isTrialDailyBudgetExceeded(args: {
  subscriptionStatus: string | null | undefined;
  billingBypass?: boolean | null;
  priorSegments24h: number;
  pendingSegments: number;
}): boolean {
  if (isTextingUnlocked(args.subscriptionStatus, args.billingBypass)) return false;
  if (args.subscriptionStatus !== "trialing") return false;
  return args.priorSegments24h + args.pendingSegments > TRIAL_DAILY_SEGMENT_CAP;
}

/**
 * Sum the outbound segments (ledger `credits`) charged to a tenant in the last
 * 24h. Reads the append-only credit_ledger — the durable record of every
 * confirmed outbound charge — so it can never double-count a carrier retry.
 */
export async function sumOutboundSegmentsLast24h(
  tenantId: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${creditLedgerTable.credits}), 0)`,
    })
    .from(creditLedgerTable)
    .where(
      and(
        eq(creditLedgerTable.tenantId, tenantId),
        eq(creditLedgerTable.direction, "outbound"),
        gte(creditLedgerTable.createdAt, cutoff),
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * Authoritative send-time demo gate. Runs both demo policies in order:
 *   1. Contact restriction — an unpaid/demo tenant may only text its signup
 *      phone (fail-closed).
 *   2. Daily trial budget — a trialing tenant is capped at
 *      TRIAL_DAILY_SEGMENT_CAP outbound segments per rolling 24h.
 * Returns a discriminated decision so the caller can surface the right 402.
 */
export async function evaluateDemoTextingGate(args: {
  tenantId: number;
  contactPhone: string;
  body: string;
  mediaCount?: number;
  forceMms?: boolean;
}): Promise<DemoGateDecision> {
  const [tenant] = await db
    .select({
      subscriptionStatus: tenantsTable.subscriptionStatus,
      billingBypass: tenantsTable.billingBypass,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, args.tenantId))
    .limit(1);

  const subscriptionStatus = tenant?.subscriptionStatus ?? null;
  const billingBypass = tenant?.billingBypass ?? false;

  // Active / operator-bypassed tenants have no demo restrictions at all.
  if (isTextingUnlocked(subscriptionStatus, billingBypass)) return { blocked: false };

  // 1) Contact restriction.
  const allowedPhone = await loadOwnerSignupPhone(args.tenantId);
  if (
    isDemoTextingBlocked({
      subscriptionStatus,
      allowedPhone,
      contactPhone: args.contactPhone,
      billingBypass,
    })
  ) {
    return {
      blocked: true,
      reason: "paywall_new_contact",
      message: PAYWALL_NEW_CONTACT_MESSAGE,
    };
  }

  // 2) Daily trial budget (trialing tenants only).
  if (subscriptionStatus === "trialing") {
    const pendingSegments = calculateMessageCredits({
      body: args.body,
      mediaCount: args.mediaCount,
      forceMms: args.forceMms,
    }).credits;
    const priorSegments24h = await sumOutboundSegmentsLast24h(args.tenantId);
    if (
      isTrialDailyBudgetExceeded({
        subscriptionStatus,
        billingBypass,
        priorSegments24h,
        pendingSegments,
      })
    ) {
      return {
        blocked: true,
        reason: "daily_trial_limit",
        message: DAILY_TRIAL_LIMIT_MESSAGE,
      };
    }
  }

  return { blocked: false };
}
