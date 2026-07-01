import { db, tenantsTable, tiersTable } from "@workspace/db";
import { eq, and, or, isNull, lt } from "drizzle-orm";
import { getUncachableStripeClient } from "./stripeClient";
import { activateSubscription } from "./stripeCheckout";
import type { SubscriptionPeriodSource } from "./stripeSubscriptionPeriod";
import { logger } from "./logger";

/**
 * Self-healing billing reconciliation.
 *
 * Activation normally happens exactly once, from the Stripe webhook. If that
 * single event ever fails (a code bug, a dropped/return-500 webhook, a delivery
 * gap) the tenant paid but stays locked forever, with nothing that re-checks.
 * This module makes the stored subscription status *re-derivable from Stripe*:
 * when a locked-looking tenant is encountered (they load the app or try to
 * send), we verify against Stripe and, if a real active/trialing subscription
 * exists, run the same idempotent activation the webhook would have.
 *
 * Cost control: only tenants that are NOT already active/bypassed AND that have
 * a real Stripe customer ever reach the network call, and even then a per-tenant
 * throttle re-checks Stripe at most once per window. The pure decision helpers
 * (`shouldQueryStripeForReconcile`, `pickReconcileTarget`) hold the tricky logic
 * so it can be unit-tested without DB or Stripe.
 */

/** Minimum spacing between live Stripe re-checks for the same tenant. */
export const BILLING_RECONCILE_THROTTLE_MS = 60_000;

export type ReconcileStripeGate =
  | { query: true }
  | {
      query: false;
      reason: "billing_bypass" | "already_active" | "no_stripe_customer" | "throttled";
    };

/**
 * Pure gate: given a tenant snapshot, decide whether it is worth calling Stripe.
 * Skips tenants that are already unlocked (active / operator bypass), that never
 * reached Stripe checkout (no real `cus_` customer), or that were re-checked
 * within the throttle window. `force` ignores only the throttle.
 */
export function shouldQueryStripeForReconcile(args: {
  subscriptionStatus: string | null | undefined;
  billingBypass: boolean | null | undefined;
  stripeCustomerId: string | null | undefined;
  lastBillingSyncAt: Date | null | undefined;
  now: number;
  throttleMs?: number;
  force?: boolean;
}): ReconcileStripeGate {
  if (args.billingBypass === true) return { query: false, reason: "billing_bypass" };
  if (args.subscriptionStatus === "active") return { query: false, reason: "already_active" };

  const cid = args.stripeCustomerId;
  // Only real Stripe customers can be verified; stub/dev ids (or none) cannot.
  if (!cid || !cid.startsWith("cus_") || cid.startsWith("cus_stub")) {
    return { query: false, reason: "no_stripe_customer" };
  }

  if (!args.force && args.lastBillingSyncAt) {
    const throttleMs = args.throttleMs ?? BILLING_RECONCILE_THROTTLE_MS;
    if (args.now - args.lastBillingSyncAt.getTime() < throttleMs) {
      return { query: false, reason: "throttled" };
    }
  }

  return { query: true };
}

export type ReconcileTarget =
  | {
      action: "activate";
      subscriptionId: string;
      tierCode: string;
      status: "active" | "trialing";
    }
  | { action: "skip"; reason: "no_active_subscription" };

/**
 * Pure selection: from the tenant's Stripe subscriptions, pick the one that
 * grants access. Prefer a truly `active` sub, then a `trialing` one; ignore
 * past_due/canceled/incomplete (they must not unlock). The tier is read from the
 * subscription metadata that checkout stamped, falling back to the tenant's
 * stored plan then a safe `starter` default so activation always has a tier.
 */
export function pickReconcileTarget(
  subs: Array<{
    id: string;
    status: string;
    metadata?: Record<string, string> | null;
    priceId?: string | null;
  }>,
  fallbackTierCode: string | null | undefined,
  priceIdToTierCode?: Map<string, string>,
): ReconcileTarget {
  const paid =
    subs.find((s) => s.status === "active") ??
    subs.find((s) => s.status === "trialing");
  if (!paid) return { action: "skip", reason: "no_active_subscription" };

  // Tier resolution, most authoritative first: the tierCode our checkout stamps
  // on the subscription metadata → the tier proven from the live Stripe price id
  // → the tenant's stored plan → a safe default so activation always has a tier.
  const priceTier =
    paid.priceId && priceIdToTierCode ? priceIdToTierCode.get(paid.priceId) : undefined;
  const tierCode =
    paid.metadata?.tierCode || priceTier || fallbackTierCode || "starter";
  return {
    action: "activate",
    subscriptionId: paid.id,
    tierCode,
    status: paid.status === "trialing" ? "trialing" : "active",
  };
}

export interface BillingReconcileResult {
  reconciled: boolean;
  status?: "active" | "trialing";
  reason?: string;
}

/**
 * Verify a single tenant's billing state against Stripe and self-heal it if it
 * paid but was left locked. Safe to call on any code path: it is throttled,
 * no-ops for already-unlocked / non-Stripe tenants, and NEVER throws (all
 * failures are logged and returned as `{ reconciled: false }`) so a Stripe
 * outage can never break a send or the billing screen.
 */
export async function reconcileTenantBillingFromStripe(
  tenantId: number,
  opts: { force?: boolean } = {},
): Promise<BillingReconcileResult> {
  const [tenant] = await db
    .select({
      id: tenantsTable.id,
      slug: tenantsTable.slug,
      stripeCustomerId: tenantsTable.stripeCustomerId,
      subscriptionStatus: tenantsTable.subscriptionStatus,
      planTierCode: tenantsTable.planTierCode,
      billingBypass: tenantsTable.billingBypass,
      lastBillingSyncAt: tenantsTable.lastBillingSyncAt,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (!tenant) return { reconciled: false, reason: "tenant_not_found" };

  const now = Date.now();
  const gate = shouldQueryStripeForReconcile({
    subscriptionStatus: tenant.subscriptionStatus,
    billingBypass: tenant.billingBypass,
    stripeCustomerId: tenant.stripeCustomerId,
    lastBillingSyncAt: tenant.lastBillingSyncAt,
    now,
    force: opts.force,
  });
  if (!gate.query) return { reconciled: false, reason: gate.reason };

  // Atomically CLAIM the throttle slot BEFORE any network call. The conditional
  // UPDATE (stamp only when null or older than the window) means that when
  // several calls fire at once for the same locked tenant, exactly one wins the
  // write and proceeds — so a concurrent burst can never double-activate or
  // double-write billing_events. A lost claim = another call is already
  // reconciling (or we're inside the window): skip. This also stops a
  // slow/failing Stripe API from being hammered; the next attempt waits out the
  // window.
  const cutoff = new Date(now - BILLING_RECONCILE_THROTTLE_MS);
  const claimed = await db
    .update(tenantsTable)
    .set({ lastBillingSyncAt: new Date(now) })
    .where(
      opts.force
        ? eq(tenantsTable.id, tenantId)
        : and(
            eq(tenantsTable.id, tenantId),
            or(
              isNull(tenantsTable.lastBillingSyncAt),
              lt(tenantsTable.lastBillingSyncAt, cutoff),
            ),
          ),
    )
    .returning({ id: tenantsTable.id });
  if (claimed.length === 0) return { reconciled: false, reason: "throttled" };

  let stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    logger.warn(
      { err, tenantId },
      "Billing reconcile: Stripe unconfigured — serving stored status",
    );
    return { reconciled: false, reason: "stripe_unconfigured" };
  }

  try {
    const list = await stripe.subscriptions.list({
      customer: tenant.stripeCustomerId as string,
      status: "all",
      limit: 10,
    });

    // Build a price-id -> tierCode map so we can prove the tier from the live
    // Stripe price when a subscription lacks our checkout's tierCode metadata,
    // instead of blindly defaulting (which would provision the wrong included-
    // credit allowance).
    const tierRows = await db
      .select({ code: tiersTable.code, stripePriceId: tiersTable.stripePriceId })
      .from(tiersTable);
    const priceIdToTierCode = new Map<string, string>();
    for (const t of tierRows) {
      if (t.stripePriceId) priceIdToTierCode.set(t.stripePriceId, t.code);
    }

    const target = pickReconcileTarget(
      list.data.map((s) => ({
        id: s.id,
        status: s.status,
        metadata: s.metadata,
        priceId: s.items?.data?.[0]?.price?.id ?? null,
      })),
      tenant.planTierCode,
      priceIdToTierCode,
    );

    if (target.action === "skip") {
      logger.info(
        { tenantId, statuses: list.data.map((s) => s.status) },
        "Billing reconcile: no active/trialing Stripe subscription — leaving tenant gated",
      );
      return { reconciled: false, reason: target.reason };
    }

    const paid = list.data.find((s) => s.id === target.subscriptionId);
    if (!paid) return { reconciled: false, reason: "no_active_subscription" };

    // Reuse the canonical, idempotent activation the webhook uses: sets status
    // active/trialing, links the sub, resolves the billing period safely, ensures
    // the usage record, and reconciles carrier add-ons.
    await activateSubscription(
      tenant.id,
      tenant.slug,
      target.tierCode,
      target.subscriptionId,
      paid as unknown as SubscriptionPeriodSource,
    );

    logger.info(
      {
        tenantId,
        subId: target.subscriptionId,
        status: target.status,
        tierCode: target.tierCode,
      },
      "Billing reconcile: self-healed a paid-but-locked tenant from Stripe",
    );

    return { reconciled: true, status: target.status };
  } catch (err) {
    logger.error(
      { err, tenantId },
      "Billing reconcile failed — serving stored status",
    );
    return { reconciled: false, reason: "stripe_error" };
  }
}
