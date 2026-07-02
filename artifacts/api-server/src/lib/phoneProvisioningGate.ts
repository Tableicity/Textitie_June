import { assertPaidTier } from "./paidTierGate";

/**
 * Single chokepoint that decides whether a tenant may self-serve PURCHASE a new
 * number. Every billing/eligibility rule for purchase belongs HERE — do not
 * scatter checks across routes.
 *
 * One env switch:
 *
 *   ENABLE_SELF_SERVE_PHONE_PURCHASE = "true"
 *     Master switch. DEFAULT OFF — a published environment must opt in. This
 *     keeps the known "open purchase hole" (any logged-in tenant buying a number
 *     billed to the platform's Twilio account, with no payment) closed in prod
 *     until self-serve is intentionally turned on.
 *
 * The billing gate is ALWAYS enforced (Stripe is live): purchasing a number is
 * a paid-tier feature. Free-trial ("trialing") tenants get their demo number
 * auto-assigned from the pool at signup and may NOT purchase more — paid =
 * subscription status "active" or the operator billingBypass override (same
 * rule as isTextingUnlocked). The legacy ENFORCE_PURCHASE_BILLING opt-in flag
 * was removed 2026-07-02 when the gate became unconditional.
 */

export type GateResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

function selfServeEnabled(): boolean {
  return process.env["ENABLE_SELF_SERVE_PHONE_PURCHASE"] === "true";
}

function twilioConfigured(): boolean {
  return Boolean(
    process.env["TWILIO_ACCOUNT_SID"] && process.env["TWILIO_AUTH_TOKEN"],
  );
}

export async function assertCanPurchaseNumber(
  tenantId: number,
): Promise<GateResult> {
  if (!selfServeEnabled()) {
    return {
      ok: false,
      status: 403,
      code: "self_serve_purchase_disabled",
      message:
        "Self-serve number purchase is not enabled for this workspace. Please contact your administrator to have a number assigned.",
    };
  }

  if (!twilioConfigured()) {
    return {
      ok: false,
      status: 503,
      code: "twilio_not_configured",
      message: "Telephony is not configured yet. Please try again later.",
    };
  }

  // --- Billing gate (ALWAYS ON) ----------------------------------------------
  // Purchasing a number is a paid-tier feature: active subscription or the
  // operator billingBypass override (shared assertPaidTier chokepoint).
  // Free-trial tenants are refused with a 402 guiding them to pick a plan.
  const billing = await assertPaidTier(tenantId, "Purchasing a number");
  if (!billing.ok) {
    return billing;
  }

  return { ok: true };
}
