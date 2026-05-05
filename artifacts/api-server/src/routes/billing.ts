import { Router } from "express";
import { db, tiersTable, billingEventsTable, tenantsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";
import {
  startSubscription,
  changePlan,
  cancelSubscription,
  getSubscriptionDetails,
  getCurrentUsageRecord,
  OVERAGE_RATE_CENTS,
  PHONE_ADDON_CENTS,
} from "../lib/stripe-stub";

const router = Router();

router.get("/billing/plans", requireTenantAuth, async (_req, res) => {
  try {
    const tiers = await db
      .select()
      .from(tiersTable)
      .orderBy(tiersTable.monthlyPriceCents);

    const plans = tiers.map((t) => ({
      tierCode: t.code,
      name: t.name,
      description: t.description,
      features: t.features,
      monthlyPriceCents: t.monthlyPriceCents,
      monthlyPriceFormatted: `$${(t.monthlyPriceCents / 100).toFixed(2)}`,
      includedCredits: t.includedCredits,
      isUnlimitedCredits: t.code === "enterprise",
      trialDays: t.trialDays,
      maxAgents: t.maxAgents === 0 ? null : t.maxAgents,
      maxPhoneNumbers: t.maxPhoneNumbers === 0 ? null : t.maxPhoneNumbers,
      overageRateCents: OVERAGE_RATE_CENTS,
      phoneAddonCents: PHONE_ADDON_CENTS,
    }));

    res.json(plans);
  } catch (err) {
    logger.error({ err }, "List billing plans error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/billing/subscription", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;

  try {
    const details = await getSubscriptionDetails(tenantId);
    res.json(details);
  } catch (err) {
    logger.error({ err }, "Get subscription error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/billing/subscribe", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { tierCode } = req.body ?? {};

  if (!tierCode || typeof tierCode !== "string") {
    res.status(400).json({ error: "tierCode is required" });
    return;
  }

  try {
    const tenant = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (tenant.length === 0) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    if (tenant[0].subscriptionStatus === "active" || tenant[0].subscriptionStatus === "trialing") {
      res.status(409).json({ error: "Already subscribed. Use change-plan to switch." });
      return;
    }

    const result = await startSubscription(tenantId, req.tenantUser!.tenantSlug, tierCode);
    res.status(201).json(result);
  } catch (err: any) {
    logger.error({ err }, "Subscribe error");
    res.status(400).json({ error: err.message ?? "Subscription failed" });
  }
});

router.post("/billing/change-plan", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { tierCode } = req.body ?? {};

  if (!tierCode || typeof tierCode !== "string") {
    res.status(400).json({ error: "tierCode is required" });
    return;
  }

  try {
    const tenant = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (tenant.length === 0) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    if (tenant[0].planTierCode === tierCode) {
      res.status(409).json({ error: "Already on this plan" });
      return;
    }

    const result = await changePlan(tenantId, req.tenantUser!.tenantSlug, tierCode);
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "Change plan error");
    res.status(400).json({ error: err.message ?? "Plan change failed" });
  }
});

router.post("/billing/cancel", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;

  try {
    const tenant = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (tenant.length === 0) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    if (tenant[0].subscriptionStatus === "none" || tenant[0].subscriptionStatus === "canceled") {
      res.status(409).json({ error: "No active subscription to cancel" });
      return;
    }

    await cancelSubscription(tenantId, req.tenantUser!.tenantSlug);
    res.json({ status: "canceled" });
  } catch (err: any) {
    logger.error({ err }, "Cancel subscription error");
    res.status(400).json({ error: err.message ?? "Cancellation failed" });
  }
});

router.get("/billing/usage", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;

  try {
    const record = await getCurrentUsageRecord(tenantId, req.tenantUser!.tenantSlug);

    const tenant = await db
      .select({ planTierCode: tenantsTable.planTierCode, subscriptionStatus: tenantsTable.subscriptionStatus })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (!record) {
      res.json({
        messagesSent: 0,
        creditsUsed: 0,
        creditsIncluded: 0,
        overageCredits: 0,
        overageAmountCents: 0,
        overageRateCents: OVERAGE_RATE_CENTS,
        isUnlimited: tenant[0]?.planTierCode === "enterprise",
        periodStart: null,
        periodEnd: null,
      });
      return;
    }

    res.json({
      messagesSent: record.messagesSent,
      creditsUsed: record.creditsUsed,
      creditsIncluded: record.creditsIncluded,
      overageCredits: record.overageCredits,
      overageAmountCents: record.overageAmountCents,
      overageRateCents: OVERAGE_RATE_CENTS,
      isUnlimited: tenant[0]?.planTierCode === "enterprise",
      periodStart: record.periodStart.toISOString(),
      periodEnd: record.periodEnd.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Get usage error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/billing/history", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;

  try {
    const events = await db
      .select()
      .from(billingEventsTable)
      .where(eq(billingEventsTable.tenantId, tenantId))
      .orderBy(desc(billingEventsTable.createdAt))
      .limit(50);

    res.json(events);
  } catch (err) {
    logger.error({ err }, "Get billing history error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
