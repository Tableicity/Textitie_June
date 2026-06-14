import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Single chokepoint that decides whether a tenant may self-serve PURCHASE a new
 * number. Every billing/eligibility rule for purchase belongs HERE — do not
 * scatter checks across routes.
 *
 * Today billing is stubbed (Stripe keys arrive later). The structure is in
 * place so that when Stripe is wired, only the "billing gate" block below
 * changes. Two env switches:
 *
 *   ENABLE_SELF_SERVE_PHONE_PURCHASE = "true"
 *     Master switch. DEFAULT OFF — a published environment must opt in. This
 *     keeps the known "open purchase hole" (any logged-in tenant buying a number
 *     billed to the platform's Twilio account, with no payment) closed in prod
 *     until self-serve is intentionally turned on.
 *
 *   ENFORCE_PURCHASE_BILLING = "true"
 *     Optional early billing enforcement (stub → real). When set, requires the
 *     tenant to have an active/trialing subscription before purchase. Left OFF
 *     until Stripe is live; flip on (and replace the stub with a real payment-
 *     method / credit check) once keys are configured.
 */

export type GateResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

const ACCEPTABLE_SUB_STATES = new Set(["active", "trialing"]);

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

  // --- Billing gate (STUB) ---------------------------------------------------
  // No-op pass-through until Stripe is wired. When ENFORCE_PURCHASE_BILLING is
  // set, do an interim subscription-status check; replace this with a real
  // Stripe check (payment method on file + active subscription / sufficient
  // credits) when keys are configured. Keep all of it inside this block.
  if (process.env["ENFORCE_PURCHASE_BILLING"] === "true") {
    const [tenant] = await db
      .select({ subscriptionStatus: tenantsTable.subscriptionStatus })
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

    if (!ACCEPTABLE_SUB_STATES.has(tenant.subscriptionStatus ?? "")) {
      return {
        ok: false,
        status: 402,
        code: "subscription_required",
        message:
          "An active subscription is required to purchase a number. Please choose a plan first.",
      };
    }
  }

  return { ok: true };
}
