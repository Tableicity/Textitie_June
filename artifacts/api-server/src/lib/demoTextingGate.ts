import { db, tenantsTable, tenantUsersTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { normalizePhoneE164 } from "./phoneNumberRegistry";

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
