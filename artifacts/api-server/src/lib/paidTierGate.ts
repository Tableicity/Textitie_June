import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isTextingUnlocked } from "./demoTextingGate";

/**
 * Shared server-side paid-tier gate for self-serve PROVISIONING features
 * (creating departments, purchasing/assigning phone numbers). Free-trial
 * tenants keep the demo department + pool number auto-provisioned at signup
 * but may not self-serve more.
 *
 * Paid = subscription status "active" or the operator billingBypass override —
 * the same rule as isTextingUnlocked, so the paywall and the provisioning
 * gates can never disagree. Every provisioning route MUST call this (the
 * client-side PaidTierGate is UX only).
 */
export type PaidTierResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

export async function assertPaidTier(
  tenantId: number,
  /** Sentence subject for the refusal message, e.g. "Creating departments". */
  feature: string,
): Promise<PaidTierResult> {
  const [tenant] = await db
    .select({
      subscriptionStatus: tenantsTable.subscriptionStatus,
      billingBypass: tenantsTable.billingBypass,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (!tenant) {
    return {
      ok: false,
      status: 404,
      code: "tenant_not_found",
      message: "Account not found.",
    };
  }

  if (!isTextingUnlocked(tenant.subscriptionStatus, tenant.billingBypass)) {
    return {
      ok: false,
      status: 402,
      code: "subscription_required",
      message: `${feature} requires a paid plan. Please choose a price package first.`,
    };
  }

  return { ok: true };
}
