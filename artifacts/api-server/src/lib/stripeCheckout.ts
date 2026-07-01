import type Stripe from "stripe";
import { db, tenantsTable, tiersTable, billingEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { getUncachableStripeClient } from "./stripeClient";
import { grantAddonCredits } from "./creditEngine";
import {
  ensureUsageRecord,
  OVERAGE_RATE_CENTS,
  PHONE_ADDON_CENTS,
} from "./stripe-stub";
import { syncCarrierBillingToStripe } from "./carrierBilling";
import {
  resolveSubscriptionPeriod,
  unixSecondsToDate,
  type SubscriptionPeriodSource,
} from "./stripeSubscriptionPeriod";

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

  const sub = rawSub as unknown as { id: string } & SubscriptionPeriodSource;

  await activateSubscription(tenantId, tenantSlug, tierCode, sub.id, sub);
}

export async function activateSubscription(
  tenantId: number,
  tenantSlug: string,
  tierCode: string,
  subscriptionId: string,
  sub: SubscriptionPeriodSource,
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
  const trialEnd = unixSecondsToDate(sub.trial_end);
  const { periodStart, periodEnd } = resolveSubscriptionPeriod(sub);
  if ((isTrialing || sub.status === "active") && (!periodStart || !periodEnd)) {
    logger.warn(
      { tenantId, subscriptionId, status: sub.status },
      "Active/trialing subscription resolved with a null billing period — storing null (Stripe payload drift?)",
    );
  }

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
  sub: { id: string; status: string } & SubscriptionPeriodSource,
): Promise<void> {
  const trialEnd = unixSecondsToDate(sub.trial_end);
  const { periodStart, periodEnd } = resolveSubscriptionPeriod(sub);

  let dbStatus: string = sub.status;
  if (!["trialing", "active", "past_due", "canceled", "incomplete"].includes(dbStatus)) {
    dbStatus = "active";
  }
  if ((dbStatus === "active" || dbStatus === "trialing") && (!periodStart || !periodEnd)) {
    logger.warn(
      { tenantId, subId: sub.id, status: dbStatus },
      "Active/trialing subscription resolved with a null billing period — storing null (Stripe payload drift?)",
    );
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

// ---------------------------------------------------------------------------
// Add-On credit purchases (one-time Stripe Checkout, webhook-fulfilled)
// ---------------------------------------------------------------------------

// Stable lookup key so the per-credit Price is found (or lazily created) in
// EVERY Stripe environment (dev/test + live). Price IDs differ between test and
// live mode, so we never store a raw price id — we resolve it by lookup_key at
// checkout time, creating the product+price on the first purchase per env.
const ADDON_CREDIT_LOOKUP_KEY = "addon_message_credit_v1";
// Business min/max per purchase. Min comfortably clears Stripe's $0.50 charge
// floor (100 × $0.03 = $3.00) and the max is an anti-abuse cap.
export const MIN_CREDIT_PURCHASE = 100;
export const MAX_CREDIT_PURCHASE = 1_000_000;

/**
 * Ensure the tenant has a REAL Stripe customer id, creating one on first use.
 * Stub/dev ids (not `cus_*`, or `cus_stub*`) are treated as missing.
 */
async function ensureStripeCustomerId(
  stripe: Stripe,
  tenantId: number,
  tenantSlug: string,
  rawCustomerId: string | null | undefined,
): Promise<string> {
  let customerId =
    rawCustomerId && rawCustomerId.startsWith("cus_") && !rawCustomerId.startsWith("cus_stub")
      ? rawCustomerId
      : undefined;

  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { tenantId: String(tenantId), tenantSlug },
    });
    customerId = customer.id;
    await db
      .update(tenantsTable)
      .set({ stripeCustomerId: customerId })
      .where(eq(tenantsTable.id, tenantId));
    logger.info({ tenantId, customerId }, "Created Stripe customer");
  }
  return customerId;
}

/**
 * Resolve the one-time per-credit Price by its stable lookup_key, creating the
 * product + price on the first purchase in this Stripe environment. Concurrent
 * first-purchases collapse safely: if the create races (duplicate lookup_key),
 * we re-resolve and use the winner.
 */
async function getOrCreateAddonCreditPrice(stripe: Stripe): Promise<string> {
  const existing = await stripe.prices.list({
    lookup_keys: [ADDON_CREDIT_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  if (existing.data[0]) return existing.data[0].id;

  try {
    const product = await stripe.products.create({
      name: "Textitie Add-On Message Credits",
      metadata: { kind: "addon_credits" },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: OVERAGE_RATE_CENTS,
      currency: "usd",
      lookup_key: ADDON_CREDIT_LOOKUP_KEY,
      nickname: "Add-on message credit",
      metadata: { kind: "addon_credits" },
    });
    logger.info({ priceId: price.id }, "Created Add-On credit Stripe price");
    return price.id;
  } catch (err) {
    // Likely a lookup_key collision from a concurrent first-purchase — re-resolve.
    const retry = await stripe.prices.list({
      lookup_keys: [ADDON_CREDIT_LOOKUP_KEY],
      active: true,
      limit: 1,
    });
    if (retry.data[0]) return retry.data[0].id;
    throw err;
  }
}

/**
 * Create a one-time Stripe Checkout session to BUY add-on message credits.
 * Fulfillment (granting the credits) happens ONLY from the webhook once the
 * payment is confirmed — this function just charges. Works for any subscription
 * status (incl. trialing).
 */
export async function createCreditCheckoutSession(
  tenantId: number,
  tenantSlug: string,
  credits: number,
  successUrl: string,
  cancelUrl: string,
): Promise<{ checkoutUrl: string; sessionId: string }> {
  if (!Number.isInteger(credits) || credits < MIN_CREDIT_PURCHASE) {
    throw new Error(`Minimum purchase is ${MIN_CREDIT_PURCHASE} credits`);
  }
  if (credits > MAX_CREDIT_PURCHASE) {
    throw new Error(`Maximum purchase is ${MAX_CREDIT_PURCHASE.toLocaleString()} credits`);
  }

  const tenants = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  if (tenants.length === 0) throw new Error("Tenant not found");
  const tenant = tenants[0];

  const stripe = await getUncachableStripeClient();
  const customerId = await ensureStripeCustomerId(
    stripe,
    tenantId,
    tenantSlug,
    tenant.stripeCustomerId,
  );
  const priceId = await getOrCreateAddonCreditPrice(stripe);

  const meta = {
    tenantId: String(tenantId),
    tenantSlug,
    kind: "addon_credits",
    credits: String(credits),
  };

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: credits }],
    metadata: meta,
    payment_intent_data: { metadata: meta },
    success_url: successUrl,
    cancel_url: cancelUrl,
    billing_address_collection: "auto",
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  logger.info(
    { tenantId, credits, sessionId: session.id },
    "Add-On credit Checkout session created",
  );

  return { checkoutUrl: session.url, sessionId: session.id };
}

/**
 * Webhook fulfillment for an add-on credit purchase. Idempotent + defensive:
 * only grants when the session is a PAID one-time `addon_credits` purchase and
 * the charged amount matches credits × the unit price. Duplicate webhooks are a
 * no-op via the ledger key `stripe:cs:<sessionId>`.
 */
export async function handleCreditCheckoutCompleted(sessionId: string): Promise<void> {
  const stripe = await getUncachableStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.mode !== "payment" || session.metadata?.kind !== "addon_credits") {
    logger.warn({ sessionId }, "Not an add-on credit checkout — skipping credit fulfillment");
    return;
  }
  if (session.payment_status !== "paid") {
    logger.info(
      { sessionId, paymentStatus: session.payment_status },
      "Add-On credit checkout not paid yet — skipping fulfillment",
    );
    return;
  }

  const tenantId = Number(session.metadata?.tenantId);
  const credits = Number(session.metadata?.credits);
  if (!tenantId || !Number.isInteger(credits) || credits <= 0) {
    logger.warn({ sessionId, tenantId, credits }, "Add-On credit checkout missing/invalid metadata — skipping");
    return;
  }

  // Fail CLOSED on the charged amount: a paid session must report a numeric
  // amount_total that exactly matches what we quoted. A missing/non-numeric
  // amount_total is treated as unverifiable and refused (never grant blind).
  const expectedCents = credits * OVERAGE_RATE_CENTS;
  if (typeof session.amount_total !== "number" || session.amount_total !== expectedCents) {
    logger.error(
      { sessionId, amountTotal: session.amount_total, expectedCents },
      "Add-On credit checkout amount missing or mismatched — refusing to fulfill",
    );
    return;
  }

  const result = await grantAddonCredits(
    tenantId,
    credits,
    `stripe:cs:${sessionId}`,
    "stripe_checkout",
  );

  if (result.granted) {
    await db.insert(billingEventsTable).values({
      tenantId,
      eventType: "credits_purchased",
      amountCents: expectedCents,
      metadata: JSON.stringify({ sessionId, credits, source: "stripe_checkout" }),
    });
  }

  logger.info(
    { tenantId, credits, sessionId, granted: result.granted, newBalance: result.newBalance },
    "Add-On credit purchase webhook processed",
  );
}
