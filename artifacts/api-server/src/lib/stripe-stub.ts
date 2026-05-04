import { db, tenantsTable, tiersTable, billingEventsTable, usageRecordsTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq, and, lte, gte, sql } from "drizzle-orm";
import { logger } from "./logger";

const OVERAGE_RATE_CENTS = 3;
const PHONE_ADDON_CENTS = 500;

function generateId(prefix: string): string {
  return `${prefix}_stub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function periodStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function periodEnd(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

export async function createStubCustomer(tenantId: number): Promise<string> {
  const customerId = generateId("cus");
  await db
    .update(tenantsTable)
    .set({ stripeCustomerId: customerId })
    .where(eq(tenantsTable.id, tenantId));
  return customerId;
}

export async function startSubscription(
  tenantId: number,
  tierCode: string,
): Promise<{
  subscriptionId: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}> {
  const tiers = await db
    .select()
    .from(tiersTable)
    .where(eq(tiersTable.code, tierCode))
    .limit(1);

  if (tiers.length === 0) {
    throw new Error(`Unknown tier: ${tierCode}`);
  }

  const tier = tiers[0];
  const subscriptionId = generateId("sub");
  const pStart = periodStart();
  const pEnd = periodEnd();

  const tenant = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (tenant.length === 0) throw new Error("Tenant not found");
  const t = tenant[0];

  let customerId = t.stripeCustomerId;
  if (!customerId) {
    customerId = await createStubCustomer(tenantId);
  }

  const canTrial = !t.trialUsed && tier.trialDays > 0;
  const now = new Date();
  const trialEnd = canTrial
    ? new Date(now.getTime() + tier.trialDays * 24 * 60 * 60 * 1000)
    : null;
  const status = trialEnd ? "trialing" : "active";

  const updated = await db
    .update(tenantsTable)
    .set({
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: status,
      planTierCode: tierCode,
      trialUsed: canTrial ? true : t.trialUsed,
      trialEndsAt: trialEnd,
      currentPeriodStart: pStart,
      currentPeriodEnd: pEnd,
    })
    .where(
      and(
        eq(tenantsTable.id, tenantId),
        sql`${tenantsTable.subscriptionStatus} IN ('none', 'canceled')`,
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw new Error("Subscription state changed concurrently. Please retry.");
  }

  await ensureUsageRecord(tenantId, tier.includedCredits);

  await db.insert(billingEventsTable).values({
    tenantId,
    eventType: trialEnd ? "trial_started" : "subscribed",
    toTier: tierCode,
    amountCents: tier.monthlyPriceCents,
    metadata: JSON.stringify({ subscriptionId, trialDays: canTrial ? tier.trialDays : 0 }),
  });

  logger.info({ tenantId, tierCode, status, subscriptionId }, "Stub subscription created");

  return { subscriptionId, status, trialEndsAt: trialEnd, currentPeriodStart: pStart, currentPeriodEnd: pEnd };
}

export async function changePlan(
  tenantId: number,
  newTierCode: string,
): Promise<{
  subscriptionId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}> {
  const tenant = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (tenant.length === 0) throw new Error("Tenant not found");
  const t = tenant[0];

  if (t.subscriptionStatus === "none" || t.subscriptionStatus === "canceled") {
    return startSubscription(tenantId, newTierCode);
  }

  const tiers = await db
    .select()
    .from(tiersTable)
    .where(eq(tiersTable.code, newTierCode))
    .limit(1);
  if (tiers.length === 0) throw new Error(`Unknown tier: ${newTierCode}`);

  const tier = tiers[0];
  const oldTier = t.planTierCode;
  const isUpgrade = tier.monthlyPriceCents > 0 && (
    (oldTier === "starter" && (newTierCode === "growth" || newTierCode === "enterprise")) ||
    (oldTier === "growth" && newTierCode === "enterprise")
  );

  const pStart = t.currentPeriodStart ?? periodStart();
  const pEnd = t.currentPeriodEnd ?? periodEnd();

  const updated = await db
    .update(tenantsTable)
    .set({
      planTierCode: newTierCode,
      subscriptionStatus: "active",
    })
    .where(
      and(
        eq(tenantsTable.id, tenantId),
        sql`${tenantsTable.subscriptionStatus} IN ('active', 'trialing')`,
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw new Error("Subscription state changed concurrently. Please retry.");
  }

  await db.insert(billingEventsTable).values({
    tenantId,
    eventType: isUpgrade ? "upgraded" : "downgraded",
    fromTier: oldTier,
    toTier: newTierCode,
    amountCents: tier.monthlyPriceCents,
  });

  const currentUsage = await getCurrentUsageRecord(tenantId);
  if (currentUsage) {
    await db
      .update(usageRecordsTable)
      .set({ creditsIncluded: tier.includedCredits })
      .where(eq(usageRecordsTable.id, currentUsage.id));
  }

  logger.info({ tenantId, from: oldTier, to: newTierCode }, "Stub plan changed");

  return {
    subscriptionId: t.stripeSubscriptionId ?? generateId("sub"),
    status: "active",
    currentPeriodStart: pStart,
    currentPeriodEnd: pEnd,
  };
}

export async function cancelSubscription(tenantId: number): Promise<void> {
  const updated = await db
    .update(tenantsTable)
    .set({
      subscriptionStatus: "canceled",
      stripeSubscriptionId: null,
    })
    .where(
      and(
        eq(tenantsTable.id, tenantId),
        sql`${tenantsTable.subscriptionStatus} IN ('active', 'trialing')`,
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw new Error("No active subscription to cancel or state changed concurrently.");
  }

  const oldTier = updated[0].planTierCode;

  await db.insert(billingEventsTable).values({
    tenantId,
    eventType: "canceled",
    fromTier: oldTier,
  });

  logger.info({ tenantId }, "Stub subscription canceled");
}

async function ensureUsageRecord(tenantId: number, creditsIncluded: number) {
  const existing = await getCurrentUsageRecord(tenantId);
  if (existing) return existing;

  const pStart = periodStart();
  const pEnd = periodEnd();

  const result = await pool.query(
    `INSERT INTO usage_records (tenant_id, period_start, period_end, credits_included)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, period_start) DO UPDATE SET credits_included = $4
     RETURNING *`,
    [tenantId, pStart, pEnd, creditsIncluded],
  );

  return result.rows[0];
}

export async function getCurrentUsageRecord(tenantId: number) {
  const now = new Date();
  const rows = await db
    .select()
    .from(usageRecordsTable)
    .where(
      and(
        eq(usageRecordsTable.tenantId, tenantId),
        lte(usageRecordsTable.periodStart, now),
        gte(usageRecordsTable.periodEnd, now),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function recordMessageUsage(tenantId: number): Promise<{
  creditsUsed: number;
  creditsIncluded: number;
  overageCredits: number;
}> {
  const tenant = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (tenant.length === 0) throw new Error("Tenant not found");
  const t = tenant[0];

  if (t.subscriptionStatus === "none" || t.subscriptionStatus === "canceled") {
    return { creditsUsed: 0, creditsIncluded: 0, overageCredits: 0 };
  }

  const tier = await db
    .select()
    .from(tiersTable)
    .where(eq(tiersTable.code, t.planTierCode ?? t.tierCode))
    .limit(1);

  const includedCredits = tier[0]?.includedCredits ?? 0;
  const isUnlimited = includedCredits === 0 && t.planTierCode === "enterprise";

  await ensureUsageRecord(tenantId, includedCredits);

  const result = await pool.query(
    `UPDATE usage_records
     SET messages_sent = messages_sent + 1,
         credits_used = credits_used + 1,
         overage_credits = CASE
           WHEN $2 THEN 0
           ELSE GREATEST(0, credits_used + 1 - credits_included)
         END,
         overage_amount_cents = CASE
           WHEN $2 THEN 0
           ELSE GREATEST(0, credits_used + 1 - credits_included) * $3
         END
     WHERE tenant_id = $1
       AND period_start <= NOW()
       AND period_end >= NOW()
     RETURNING credits_used, credits_included, overage_credits`,
    [tenantId, isUnlimited, OVERAGE_RATE_CENTS],
  );

  if (result.rows.length === 0) {
    return { creditsUsed: 0, creditsIncluded: 0, overageCredits: 0 };
  }

  const row = result.rows[0];
  return {
    creditsUsed: row.credits_used,
    creditsIncluded: row.credits_included,
    overageCredits: row.overage_credits,
  };
}

export async function getSubscriptionDetails(tenantId: number) {
  const tenant = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (tenant.length === 0) return null;
  const t = tenant[0];

  let tier = null;
  if (t.planTierCode) {
    const rows = await db
      .select()
      .from(tiersTable)
      .where(eq(tiersTable.code, t.planTierCode))
      .limit(1);
    tier = rows[0] ?? null;
  }

  return {
    subscriptionId: t.stripeSubscriptionId,
    customerId: t.stripeCustomerId,
    status: t.subscriptionStatus,
    planTierCode: t.planTierCode,
    planName: tier?.name ?? null,
    monthlyPriceCents: tier?.monthlyPriceCents ?? 0,
    includedCredits: tier?.includedCredits ?? 0,
    trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
    currentPeriodStart: t.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: t.currentPeriodEnd?.toISOString() ?? null,
  };
}

export { OVERAGE_RATE_CENTS, PHONE_ADDON_CENTS };
