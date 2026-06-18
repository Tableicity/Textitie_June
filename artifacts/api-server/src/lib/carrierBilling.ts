// Per-number carrier billing config + compute/sync.
//
// These are GLOBAL (not per-tier) recurring add-ons that attach to a tenant's
// Stripe subscription as quantity-based line items. They apply to LOCAL numbers
// only — toll-free numbers are exempt from both the carrier fee and the
// unregistered surcharge.
//
// The price IDs are intentionally hardcoded constants (not DB-seeded) so they
// deploy to production with the code — there is no per-environment data step.
// They live in the live Stripe account acct_1TEdhl0tnuZQWyqK.
//
//   Carrier Fee                      $15.00/mo  prod_UizZsv6vxs2BeI
//   Unregistered Carrier Surcharge   $10.00/mo  prod_UizZmWrqMHeWRj

import { db, phoneNumbersTable, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUncachableStripeClient } from "./stripeClient";
import { logger } from "./logger";

export const CARRIER_FEE_CENTS = 1500;
export const UNREGISTERED_SURCHARGE_CENTS = 1000;

export const CARRIER_FEE_PRICE_ID = "price_1TjXaY0tnuZQWyqK1Ov9SQxy";
export const UNREGISTERED_SURCHARGE_PRICE_ID = "price_1TjXaZ0tnuZQWyqKVCxNOJGQ";

export const CARRIER_FEE_FORMATTED = `$${(CARRIER_FEE_CENTS / 100).toFixed(2)}`;
export const UNREGISTERED_SURCHARGE_FORMATTED = `$${(UNREGISTERED_SURCHARGE_CENTS / 100).toFixed(2)}`;

/**
 * Per-tenant carrier billing snapshot, derived purely from the canonical
 * `phone_numbers` registry + the tenant's surcharge flag. This is the SOURCE OF
 * TRUTH for what the tenant should be billed in recurring add-ons, and the only
 * thing the UI / invoice itemization reads — so it behaves identically whether
 * the tenant has a real Stripe subscription or a dev stub.
 *
 * Billing rules (confirmed):
 *   - Every LOCAL number incurs the carrier fee (qty = # local numbers).
 *   - Every UNREGISTERED local number incurs the surcharge, UNLESS the tenant's
 *     surcharge is waived (then surcharge qty = 0).
 *   - Toll-free numbers are exempt from both.
 *   - Plan "included" numbers are NOT subtracted — bundling, not a discount.
 */
export interface CarrierBillingSnapshot {
  localCount: number;
  tollFreeCount: number;
  unregisteredLocalCount: number;
  surchargeEnabled: boolean;
  carrierFeeCents: number;
  surchargeCents: number;
  carrierLineCents: number;
  surchargeLineCents: number;
  totalRecurringCents: number;
}

export async function computeCarrierBillingSnapshot(
  tenantId: number,
): Promise<CarrierBillingSnapshot> {
  const [tenant] = await db
    .select({ surchargeEnabled: tenantsTable.unregisteredSurchargeEnabled })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const surchargeEnabled = tenant?.surchargeEnabled ?? true;

  const rows = await db
    .select({
      numberType: phoneNumbersTable.numberType,
      registrationStatus: phoneNumbersTable.registrationStatus,
    })
    .from(phoneNumbersTable)
    .where(eq(phoneNumbersTable.tenantId, tenantId));

  let localCount = 0;
  let tollFreeCount = 0;
  let unregisteredLocalCount = 0;
  for (const r of rows) {
    if (r.numberType === "toll_free") {
      tollFreeCount += 1;
    } else {
      localCount += 1;
      if (r.registrationStatus !== "registered") unregisteredLocalCount += 1;
    }
  }

  const surchargeQty = surchargeEnabled ? unregisteredLocalCount : 0;
  const carrierLineCents = localCount * CARRIER_FEE_CENTS;
  const surchargeLineCents = surchargeQty * UNREGISTERED_SURCHARGE_CENTS;

  return {
    localCount,
    tollFreeCount,
    unregisteredLocalCount,
    surchargeEnabled,
    carrierFeeCents: CARRIER_FEE_CENTS,
    surchargeCents: UNREGISTERED_SURCHARGE_CENTS,
    carrierLineCents,
    surchargeLineCents,
    totalRecurringCents: carrierLineCents + surchargeLineCents,
  };
}

export type CarrierSyncMode = "synced" | "computed_only";

export interface CarrierSyncResult {
  mode: CarrierSyncMode;
  snapshot: CarrierBillingSnapshot;
}

function isRealStripeSubscription(subId: string | null | undefined): subId is string {
  return !!subId && subId.startsWith("sub_") && !subId.startsWith("sub_stub");
}

/**
 * Reconcile the tenant's Stripe subscription add-on items to match the snapshot.
 *
 * Idempotent by DISCOVERY (no stored item IDs): for each managed price we find
 * its item on the subscription and create / update-quantity / delete to match
 * the desired quantity. Duplicate items for the same price are collapsed to one.
 *
 * No-ops (returns mode:"computed_only") for stub/dev subscriptions, missing
 * subscriptions, or non-billable states — those tenants are billed purely off
 * the computed snapshot. NEVER call this inside a DB transaction; call it
 * best-effort AFTER the registry write commits.
 */
export async function syncCarrierBillingToStripe(
  tenantId: number,
  reason: string,
): Promise<CarrierSyncResult> {
  const snapshot = await computeCarrierBillingSnapshot(tenantId);

  const [tenant] = await db
    .select({
      stripeSubscriptionId: tenantsTable.stripeSubscriptionId,
      subscriptionStatus: tenantsTable.subscriptionStatus,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const subId = tenant?.stripeSubscriptionId;
  const status = tenant?.subscriptionStatus ?? "none";
  const billable = ["active", "trialing", "past_due", "incomplete"].includes(status);

  if (!isRealStripeSubscription(subId) || !billable) {
    return { mode: "computed_only", snapshot };
  }

  // Each reconcile re-fetches the LIVE subscription items itself (see
  // reconcileSubscriptionItem), so the carrier-fee pass and the surcharge pass
  // never act on a snapshot that the other pass has already mutated. Passing a
  // single snapshot captured here would let the second pass see an item the
  // first pass already deleted, bypassing the last-item guard.
  await reconcileSubscriptionItem(subId, CARRIER_FEE_PRICE_ID, snapshot.localCount);
  // Surcharge qty already accounts for the tenant's waiver flag in the snapshot.
  const surchargeQty = snapshot.surchargeEnabled ? snapshot.unregisteredLocalCount : 0;
  await reconcileSubscriptionItem(
    subId,
    UNREGISTERED_SURCHARGE_PRICE_ID,
    surchargeQty,
  );

  logger.info(
    {
      tenantId,
      reason,
      subId,
      localCount: snapshot.localCount,
      surchargeQty,
    },
    "Carrier billing synced to Stripe subscription",
  );

  return { mode: "synced", snapshot };
}

type StripeSubItem = {
  id: string;
  quantity?: number;
  price: { id: string };
};

// Exported for unit testing of the last-item delete guard (otherwise private).
export async function reconcileSubscriptionItem(
  subscriptionId: string,
  priceId: string,
  desiredQty: number,
): Promise<void> {
  const stripe = await getUncachableStripeClient();
  // Re-fetch the LIVE item list on each call. syncCarrierBillingToStripe invokes
  // this once per managed price; an earlier pass may have created or deleted
  // items, so a snapshot captured before the first pass would be stale and could
  // bypass the last-item guard below.
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const items = (sub.items.data as unknown as StripeSubItem[]);
  const matching = items.filter((i) => i.price.id === priceId);

  if (desiredQty <= 0) {
    if (matching.length === 0) return;
    // Stripe forbids deleting the last remaining item on a subscription. The
    // base plan item uses a different price, so it normally protects us — but
    // if it is somehow absent (an anomaly that should never happen) deleting
    // every managed add-on would empty the subscription and 500 the whole sync.
    // Because `items` is the LIVE list, this guard sees deletions made by an
    // earlier pass and refuses to remove the final remaining item. Keep one item
    // and log loudly instead: a single stale add-on is far less harmful than
    // aborting reconciliation with a Stripe error.
    const otherItems = items.filter((i) => i.price.id !== priceId);
    const lastItemId = matching[matching.length - 1]!.id;
    for (const it of matching) {
      if (otherItems.length === 0 && it.id === lastItemId) {
        logger.error(
          { subscriptionId, priceId, itemId: it.id },
          "CRITICAL: refusing to delete the last subscription item — base plan item missing?",
        );
        continue;
      }
      await stripe.subscriptionItems.del(it.id, {
        proration_behavior: "create_prorations",
      });
    }
    return;
  }

  if (matching.length === 0) {
    await stripe.subscriptionItems.create({
      subscription: subscriptionId,
      price: priceId,
      quantity: desiredQty,
      proration_behavior: "create_prorations",
    });
    return;
  }

  const [keep, ...extras] = matching;
  if ((keep!.quantity ?? 0) !== desiredQty) {
    await stripe.subscriptionItems.update(keep!.id, {
      quantity: desiredQty,
      proration_behavior: "create_prorations",
    });
  }
  for (const ex of extras) {
    await stripe.subscriptionItems.del(ex.id, {
      proration_behavior: "create_prorations",
    });
  }
}
