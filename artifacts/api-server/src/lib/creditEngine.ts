import { pool } from "@workspace/db";
import { logger } from "./logger";
import { BACKUP_BLOCK_SIZE } from "./backupTopupProvider";

// ---------------------------------------------------------------------------
// Balance readers + manual grant on top of the 3-bucket model
// (Included → Add-On → Backup). The transactional per-message charge lives in
// creditService.ts; this file is the read/aggregate + manual-credit surface
// used by the campaign routes. Legacy field names (prepaidCredits,
// overageEnabled, availableCredits) are preserved for existing callers.
// ---------------------------------------------------------------------------

interface TenantBucketRow {
  id: number;
  plan_tier_code: string | null;
  tier_code: string | null;
  addon_credits: number;
  backup_credits: number;
  credit_debt: number;
  backup_enabled: boolean;
  backup_topup_cap_per_cycle: number;
  prepaid_credits: number;
  credit_buckets_migrated_at: Date | null;
  overage_enabled: boolean;
}

interface UsageBucketRow {
  credits_included: number;
  included_credits_used: number;
  backup_topups_count: number;
}

interface CoverageSnapshot {
  found: boolean;
  unlimited: boolean;
  includedRemaining: number;
  addon: number;
  backup: number;
  replenishableBackup: number;
  debt: number;
  overageEnabled: boolean;
}

async function readCoverage(tenantId: number): Promise<CoverageSnapshot> {
  const tr = await pool.query<TenantBucketRow>(
    `SELECT id, plan_tier_code, tier_code, addon_credits, backup_credits,
            credit_debt, backup_enabled, backup_topup_cap_per_cycle,
            prepaid_credits, credit_buckets_migrated_at, overage_enabled
       FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId],
  );
  if (tr.rows.length === 0) {
    return {
      found: false,
      unlimited: false,
      includedRemaining: 0,
      addon: 0,
      backup: 0,
      replenishableBackup: 0,
      debt: 0,
      overageEnabled: false,
    };
  }
  const t = tr.rows[0];
  const unlimited = (t.plan_tier_code ?? t.tier_code) === "enterprise";

  const addon =
    t.addon_credits + (t.credit_buckets_migrated_at == null ? t.prepaid_credits : 0);

  const ur = await pool.query<UsageBucketRow>(
    `SELECT credits_included, included_credits_used, backup_topups_count
       FROM usage_records
      WHERE tenant_id = $1 AND period_start <= NOW() AND period_end >= NOW()
      ORDER BY period_start DESC
      LIMIT 1`,
    [tenantId],
  );
  const usage = ur.rows[0] ?? null;
  const includedRemaining = usage
    ? Math.max(0, usage.credits_included - usage.included_credits_used)
    : 0;

  let replenishableBackup = 0;
  if (t.backup_enabled && usage) {
    const cap = t.backup_topup_cap_per_cycle ?? 0;
    const blocksAvailable = Math.max(0, cap - usage.backup_topups_count);
    replenishableBackup = blocksAvailable * BACKUP_BLOCK_SIZE;
  }

  return {
    found: true,
    unlimited,
    includedRemaining,
    addon,
    backup: t.backup_credits,
    replenishableBackup,
    debt: t.credit_debt,
    overageEnabled: t.overage_enabled ?? false,
  };
}

export interface PreFlightResult {
  allowed: boolean;
  requiredCredits: number;
  availableCredits: number;
  prepaidCredits: number;
  includedRemaining: number;
  overageEnabled: boolean;
  shortfall: number;
}

/**
 * Bulk preflight for campaigns. Coverage spans Included + Add-On + Backup +
 * the Backup still auto-replenishable this cycle. Enterprise is unlimited.
 */
export async function preFlightCheck(
  tenantId: number,
  _tenantSlug: string,
  recipientCount: number,
  segmentsPerMessage: number,
): Promise<PreFlightResult> {
  const cov = await readCoverage(tenantId);
  const requiredCredits = recipientCount * segmentsPerMessage;

  if (!cov.found) {
    return {
      allowed: false,
      requiredCredits,
      availableCredits: 0,
      prepaidCredits: 0,
      includedRemaining: 0,
      overageEnabled: false,
      shortfall: requiredCredits,
    };
  }

  if (cov.unlimited) {
    return {
      allowed: true,
      requiredCredits,
      availableCredits: Infinity,
      prepaidCredits: cov.addon,
      includedRemaining: Infinity,
      overageEnabled: cov.overageEnabled,
      shortfall: 0,
    };
  }

  const availableCredits =
    cov.includedRemaining + cov.addon + cov.backup + cov.replenishableBackup;
  const shortfall = Math.max(0, requiredCredits - availableCredits);

  return {
    allowed: shortfall === 0,
    requiredCredits,
    availableCredits,
    prepaidCredits: cov.addon,
    includedRemaining: cov.includedRemaining,
    overageEnabled: cov.overageEnabled,
    shortfall,
  };
}

export interface CreditBalance {
  prepaidCredits: number;
  addonCredits: number;
  backupCredits: number;
  creditDebt: number;
  includedRemaining: number;
  totalAvailable: number;
  overageEnabled: boolean;
}

export async function getCreditBalance(
  tenantId: number,
  _tenantSlug: string,
): Promise<CreditBalance> {
  const cov = await readCoverage(tenantId);
  const includedRemaining = cov.unlimited ? -1 : cov.includedRemaining;
  const totalAvailable = cov.unlimited
    ? -1
    : cov.includedRemaining + cov.addon + cov.backup;
  return {
    prepaidCredits: cov.addon,
    addonCredits: cov.addon,
    backupCredits: cov.backup,
    creditDebt: cov.debt,
    includedRemaining,
    totalAvailable,
    overageEnabled: cov.overageEnabled,
  };
}

export interface GrantAddonResult {
  /** True only when THIS call actually applied the grant (ledger row inserted). */
  granted: boolean;
  /** The Add-On balance after this movement (or the current balance on a no-op). */
  newBalance: number;
}

/**
 * Grant Add-On (rollover) credits IDEMPOTENTLY, keyed on `idempotencyKey`.
 *
 * This is the ONE money-safe primitive for adding Add-On credits (Stripe
 * purchase fulfillment, Conductor comp grants, …). The ledger's unique
 * (tenant_id, idempotency_key, reason) index is the guard: a duplicate Stripe
 * webhook / carrier retry with the same key inserts nothing and leaves the
 * balance untouched, so credits are granted EXACTLY once. Never mint a random
 * key here — the caller owns the key (e.g. `stripe:cs:<sessionId>`) so retries
 * collapse to a no-op.
 *
 * Records a signed `grant_addon` ledger row and returns whether it applied plus
 * the resulting Add-On balance. Runs the addon/prepaid bucket migration inline
 * (mirrors the charge path) the first time a tenant's buckets are touched.
 */
export async function grantAddonCredits(
  tenantId: number,
  credits: number,
  idempotencyKey: string,
  source = "manual",
): Promise<GrantAddonResult> {
  if (!Number.isFinite(credits) || credits <= 0 || !Number.isInteger(credits)) {
    throw new Error("grantAddonCredits: credits must be a positive integer");
  }
  if (!idempotencyKey) {
    throw new Error("grantAddonCredits: idempotencyKey is required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tr = await client.query<{ addon_credits: number; prepaid_credits: number; credit_buckets_migrated_at: Date | null }>(
      `SELECT addon_credits, prepaid_credits, credit_buckets_migrated_at
         FROM tenants WHERE id = $1 FOR UPDATE`,
      [tenantId],
    );
    if (tr.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new Error("Tenant not found");
    }
    const row = tr.rows[0];
    const migrate = row.credit_buckets_migrated_at == null;
    const base = row.addon_credits + (migrate ? row.prepaid_credits : 0);
    const newBalance = base + credits;

    // The ledger insert is the idempotency guard: a second attempt with the same
    // (tenant_id, idempotencyKey, reason) inserts nothing → we DON'T touch the
    // balance and report granted=false with the CURRENT balance.
    const ins = await client.query<{ id: number }>(
      `INSERT INTO credit_ledger
         (tenant_id, idempotency_key, reason, credits, addon_delta, addon_after,
          status, metadata)
       VALUES ($1,$2,'grant_addon',$3,$3,$4,'applied',$5)
       ON CONFLICT (tenant_id, idempotency_key, reason) DO NOTHING
       RETURNING id`,
      [tenantId, idempotencyKey, credits, newBalance, JSON.stringify({ source })],
    );

    if (ins.rows.length === 0) {
      await client.query("COMMIT");
      logger.info({ tenantId, idempotencyKey }, "Add-On grant already applied — no-op");
      return { granted: false, newBalance: base };
    }

    await client.query(
      `UPDATE tenants
          SET addon_credits = $2,
              prepaid_credits = CASE WHEN $3 THEN 0 ELSE prepaid_credits END,
              credit_buckets_migrated_at = COALESCE(credit_buckets_migrated_at, NOW())
        WHERE id = $1`,
      [tenantId, newBalance, migrate],
    );

    await client.query("COMMIT");
    logger.info({ tenantId, added: credits, newBalance, source }, "Add-On credits granted");
    return { granted: true, newBalance };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @deprecated Aggregate post-send campaign deduction. Superseded by per-message
 * `chargeMessageCredits` (campaign_charge). Retained until the campaign engine
 * is switched over; do not add new callers.
 */
export async function deductCampaignCredits(
  tenantId: number,
  _tenantSlug: string,
  creditsUsed: number,
): Promise<void> {
  logger.warn(
    { tenantId, creditsUsed },
    "deductCampaignCredits is deprecated; per-message charge should be used",
  );
}
