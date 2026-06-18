import { db, tenantsTable, tiersTable, billingEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { getUncachableStripeClient } from "./stripeClient";
import {
  ensureUsageRecord,
  OVERAGE_RATE_CENTS,
  PHONE_ADDON_CENTS,
} from "./stripe-stub";
import { syncCarrierBillingToStripe } from "./carrierBilling";

export { OVERAGE_RATE_CENTS, PHONE_ADDON_CENTS };

export async function createCheckoutSession(
  tenantId: number,
  tenantSlug: string,
  tierCode: string,
  successUrl: string,
  cancelUrl: string,
): Promise<{ checkoutUrl: string; sessionId: string }> {
  const tiers = await db
    .select()
    .from(tiersTable)
    .where(eq(tiersTable.code, tierCode))
    .limit(1);

  if (tiers.length === 0) throw new Error(`Unknown tier: ${tierCode}`);
  const tier = tiers[0];

  if (!tier.stripePriceId) {
    throw new Error(
      `Tier "${tierCode}" has no Stripe price configured. Contact support for Enterprise pricing.`,
    );
  }

  const tenants = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (tenants.length === 0) throw new Error("Tenant not found");
  const tenant = tenants[0];

  const stripe = await getUncachableStripeClient();

  // Treat stub/dev customer IDs (not real Stripe cus_*) as missing so we
  // create a real one on the first live checkout attempt.
  const rawCustomerId = tenant.stripeCustomerId;
  let customerId = (rawCustomerId && rawCustomerId.startsWith("cus_") && !rawCustomerId.startsWith("cus_stub"))
    ? rawCustomerId
    : undefined;

  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: {
        tenantId: String(tenantId),
        tenantSlug,
      },
    });
    customerId = customer.id;
    await db
      .update(tenantsTable)
      .set({ stripeCustomerId: customerId })
      .where(eq(tenantsTable.id, tenantId));
    logger.info({ tenantId, customerId }, "Created Stripe customer");
  }

  const canTrial = !tenant.trialUsed && tier.trialDays > 0;

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [
      {
        price: tier.stripePriceId,
        quantity: 1,
      },
    ],
    subscription_data: canTrial
      ? {
          trial_period_days: tier.trialDays,
          metadata: {
            tenantId: String(tenantId),
            tenantSlug,
            tierCode,
          },
        }
      : {
          metadata: {
            tenantId: String(tenantId),
            tenantSlug,
            tierCode,
          },
        },
    metadata: {
      tenantId: String(tenantId),
      tenantSlug,
      tierCode,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  logger.info(
    { tenantId, tierCode, sessionId: session.id, canTrial },
    "Stripe Checkout session created",
  );

  return { checkoutUrl: session.url, sessionId: session.id };
}

export async function handleCheckoutSessionCompleted(
  sessionId: string,
): Promise<void> {
  const stripe = await getUncachableStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });

  const tenantId = Number(session.metadata?.tenantId);
  const tenantSlug = session.metadata?.tenantSlug ?? "";
  const tierCode = session.metadata?.tierCode ?? "";

  if (!tenantId || !tierCode) {
    logger.warn({ sessionId }, "Checkout session missing metadata — skipping");
    return;
  }

  const rawSub = session.subscription;
  if (!rawSub || typeof rawSub === "string") {
    logger.warn({ sessionId }, "No expanded subscription on checkout session");
    return;
  }

  const sub = rawSub as unknown as {
    id: string;
    status: string;
    trial_end: number | null;
    current_period_start: number;
    current_period_end: number;
  };

  await activateSubscription(tenantId, tenantSlug, tierCode, sub.id, sub);
}

export async function activateSubscription(
  tenantId: number,
  tenantSlug: string,
  tierCode: string,
  subscriptionId: string,
  sub: {
    status: string;
    trial_end: number | null;
    current_period_start: number;
    current_period_end: number;
  },
): Promise<void> {
  const tiers = await db
    .select()
    .from(tiersTable)
    .where(eq(tiersTable.code, tierCode))
    .limit(1);
  if (tiers.length === 0) {
    logger.warn({ tierCode }, "Unknown tier in activateSubscription");
    return;
  }
  const tier = tiers[0];

  const isTrialing = sub.status === "trialing";
  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
  const periodStart = new Date(sub.current_period_start * 1000);
  const periodEnd = new Date(sub.current_period_end * 1000);

  const existing = await db
    .select({ stripeSubscriptionId: tenantsTable.stripeSubscriptionId, trialUsed: tenantsTable.trialUsed })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const alreadyTrialUsed = existing[0]?.trialUsed ?? false;

  await db
    .update(tenantsTable)
    .set({
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: isTrialing ? "trialing" : "active",
      planTierCode: tierCode,
      trialUsed: alreadyTrialUsed || isTrialing,
      trialEndsAt: trialEnd,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    })
    .where(eq(tenantsTable.id, tenantId));

  await ensureUsageRecord(tenantId, tenantSlug, tier.includedCredits);

  await db.insert(billingEventsTable).values({
    tenantId,
    eventType: isTrialing ? "trial_started" : "subscribed",
    toTier: tierCode,
    amountCents: tier.monthlyPriceCents,
    metadata: JSON.stringify({ subscriptionId, source: "stripe_checkout" }),
  });

  logger.info(
    { tenantId, tierCode, subscriptionId, status: sub.status },
    "Subscription activated from Stripe",
  );

  // A tenant can buy numbers BEFORE subscribing (purchases are unbarred). While
  // they were on a stub/no subscription, carrier add-ons were computed_only and
  // never pushed to Stripe. Now that a real billable sub exists, reconcile the
  // carrier add-on items so we stop underbilling. Best-effort: never fail
  // activation on a sync error — the next purchase/toggle/reconcile will retry.
  try {
    await syncCarrierBillingToStripe(tenantId, "subscription_activated");
  } catch (err) {
    logger.error(
      { err, tenantId },
      "CRITICAL: carrier billing sync failed after subscription activation",
    );
  }
}

export async function handleSubscriptionUpdated(
  tenantId: number,
  tenantSlug: string,
  tierCode: string,
  sub: {
    id: string;
    status: string;
    trial_end: number | null;
    current_period_start: number;
    current_period_end: number;
  },
): Promise<void> {
  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
  const periodStart = new Date(sub.current_period_start * 1000);
  const periodEnd = new Date(sub.current_period_end * 1000);

  let dbStatus: string = sub.status;
  if (!["trialing", "active", "past_due", "canceled", "incomplete"].includes(dbStatus)) {
    dbStatus = "active";
  }

  await db
    .update(tenantsTable)
    .set({
      stripeSubscriptionId: sub.id,
      subscriptionStatus: dbStatus,
      planTierCode: tierCode,
      trialEndsAt: trialEnd,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    })
    .where(eq(tenantsTable.id, tenantId));

  logger.info(
    { tenantId, tierCode, status: dbStatus },
    "Subscription updated from webhook",
  );

  // Status transitions (e.g. trialing/incomplete -> active, or a sub becoming
  // billable) can change whether carrier add-ons should be pushed to Stripe.
  // Reconcile best-effort so we don't leave the add-on items stale.
  try {
    await syncCarrierBillingToStripe(tenantId, "subscription_updated");
  } catch (err) {
    logger.error(
      { err, tenantId },
      "CRITICAL: carrier billing sync failed after subscription update",
    );
  }
}

export async function handleSubscriptionDeleted(
  tenantId: number,
  tenantSlug: string,
  subscriptionId: string,
): Promise<void> {
  const tenant = await db
    .select({ planTierCode: tenantsTable.planTierCode })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const fromTier = tenant[0]?.planTierCode ?? undefined;

  await db
    .update(tenantsTable)
    .set({
      subscriptionStatus: "canceled",
      stripeSubscriptionId: null,
    })
    .where(eq(tenantsTable.id, tenantId));

  await db.insert(billingEventsTable).values({
    tenantId,
    eventType: "canceled",
    fromTier,
    metadata: JSON.stringify({ subscriptionId, source: "stripe_webhook" }),
  });

  logger.info({ tenantId, subscriptionId }, "Subscription canceled via webhook");
}

export async function handlePaymentSucceeded(
  tenantId: number,
  amountCents: number,
  invoiceId: string,
): Promise<void> {
  await db.insert(billingEventsTable).values({
    tenantId,
    eventType: "payment_succeeded",
    amountCents,
    metadata: JSON.stringify({ invoiceId, source: "stripe_webhook" }),
  });
  logger.info({ tenantId, amountCents, invoiceId }, "Payment succeeded recorded");
}

export async function handlePaymentFailed(
  tenantId: number,
  amountCents: number,
  invoiceId: string,
): Promise<void> {
  await db
    .update(tenantsTable)
    .set({ subscriptionStatus: "past_due" })
    .where(eq(tenantsTable.id, tenantId));

  await db.insert(billingEventsTable).values({
    tenantId,
    eventType: "payment_failed",
    amountCents,
    metadata: JSON.stringify({ invoiceId, source: "stripe_webhook" }),
  });
  logger.warn({ tenantId, amountCents, invoiceId }, "Payment failed — marked past_due");
}
