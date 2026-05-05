import { db, getTenantDb, getTenantPool, tenantsTable, usageRecordsTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq, and, lte, gte } from "drizzle-orm";
import { logger } from "./logger";

export interface PreFlightResult {
  allowed: boolean;
  requiredCredits: number;
  availableCredits: number;
  prepaidCredits: number;
  includedRemaining: number;
  overageEnabled: boolean;
  shortfall: number;
}

export async function preFlightCheck(
  tenantId: number,
  tenantSlug: string,
  recipientCount: number,
  segmentsPerMessage: number,
): Promise<PreFlightResult> {
  const tenant = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (tenant.length === 0) {
    return {
      allowed: false,
      requiredCredits: 0,
      availableCredits: 0,
      prepaidCredits: 0,
      includedRemaining: 0,
      overageEnabled: false,
      shortfall: 0,
    };
  }

  const t = tenant[0];
  const prepaidCredits = t.prepaidCredits ?? 0;
  const overageEnabled = t.overageEnabled ?? false;

  const tdb = getTenantDb(tenantSlug);
  let includedRemaining = 0;
  const now = new Date();
  const usageRows = await tdb
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

  if (usageRows.length > 0) {
    const usage = usageRows[0];
    includedRemaining = Math.max(0, usage.creditsIncluded - usage.creditsUsed);
  }

  if (t.planTierCode === "enterprise") {
    includedRemaining = Infinity;
  }

  const requiredCredits = recipientCount * segmentsPerMessage;
  const availableCredits = prepaidCredits + (includedRemaining === Infinity ? requiredCredits : includedRemaining);
  const shortfall = Math.max(0, requiredCredits - availableCredits);

  const allowed = shortfall === 0 || overageEnabled;

  return {
    allowed,
    requiredCredits,
    availableCredits: includedRemaining === Infinity ? Infinity : availableCredits,
    prepaidCredits,
    includedRemaining: includedRemaining === Infinity ? Infinity : includedRemaining,
    overageEnabled,
    shortfall,
  };
}

export async function deductCampaignCredits(
  tenantId: number,
  tenantSlug: string,
  creditsUsed: number,
): Promise<void> {
  const tenant = await db
    .select({ prepaidCredits: tenantsTable.prepaidCredits })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (tenant.length === 0) return;

  const prepaid = tenant[0].prepaidCredits ?? 0;
  const tpool = getTenantPool(tenantSlug);

  if (prepaid >= creditsUsed) {
    // tenants lives in public — use the global pool
    await pool.query(
      `UPDATE tenants SET prepaid_credits = prepaid_credits - $1 WHERE id = $2`,
      [creditsUsed, tenantId],
    );
  } else {
    if (prepaid > 0) {
      await pool.query(
        `UPDATE tenants SET prepaid_credits = 0 WHERE id = $1`,
        [tenantId],
      );
    }
    const overflowToUsage = creditsUsed - prepaid;
    if (overflowToUsage > 0) {
      const now = new Date();
      // usage_records lives per-tenant — use the per-tenant pool
      await tpool.query(
        `UPDATE usage_records
         SET credits_used = credits_used + $1,
             messages_sent = messages_sent + $1,
             overage_credits = GREATEST(0, credits_used + $1 - credits_included),
             overage_amount_cents = GREATEST(0, credits_used + $1 - credits_included) * 3
         WHERE tenant_id = $2
           AND period_start <= $3
           AND period_end >= $3`,
        [overflowToUsage, tenantId, now],
      );
    }
  }

  logger.info({ tenantId, creditsUsed }, "Campaign credits deducted");
}

export async function getCreditBalance(tenantId: number, tenantSlug: string): Promise<{
  prepaidCredits: number;
  includedRemaining: number;
  totalAvailable: number;
  overageEnabled: boolean;
}> {
  const result = await preFlightCheck(tenantId, tenantSlug, 0, 0);
  return {
    prepaidCredits: result.prepaidCredits,
    includedRemaining: result.includedRemaining === Infinity ? -1 : result.includedRemaining,
    totalAvailable: result.availableCredits === Infinity ? -1 : result.availableCredits,
    overageEnabled: result.overageEnabled,
  };
}

export async function addPrepaidCredits(
  tenantId: number,
  credits: number,
): Promise<number> {
  const result = await pool.query(
    `UPDATE tenants SET prepaid_credits = prepaid_credits + $1 WHERE id = $2 RETURNING prepaid_credits`,
    [credits, tenantId],
  );
  if (result.rows.length === 0) throw new Error("Tenant not found");
  const newBalance = result.rows[0].prepaid_credits;
  logger.info({ tenantId, added: credits, newBalance }, "Prepaid credits added");
  return newBalance;
}
