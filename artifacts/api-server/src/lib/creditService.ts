import { pool } from "@workspace/db";
import { logger } from "./logger";
import { calculateMessageCredits, type MessageChannel } from "./messageCost";
import {
  authorizeBackupTopup,
  BACKUP_BLOCK_SIZE,
} from "./backupTopupProvider";

// ===========================================================================
// Transactional credit-deduction engine.
//
// Every live message (inbound, outbound, campaign) flows through
// `chargeMessageCredits`, which atomically:
//   1. Locks the tenant row (serializes all charges for that tenant).
//   2. Idempotency-guards on the credit_ledger unique (tenant, key, reason) —
//      a carrier retry / duplicate webhook is a safe no-op.
//   3. Refund-before-charge guards: if a refund already landed for this
//      message, the charge no-ops (the message was rejected first).
//   4. Lazily migrates the legacy prepaidCredits balance into Add-On once.
//   5. Drains the strict waterfall Included → Add-On → Backup.
//   6. OUTBOUND only: when buckets are exhausted, auto-replenishes Backup in
//      250-credit blocks (capped per cycle) before any shortfall.
//   7. Applies any remainder to creditDebt (inbound always; outbound only as a
//      last-resort post-send race — the preflight gate should prevent it).
//   8. Writes the signed ledger row + materialized bucket balances.
//
// The hard-stop for outbound is the read-only `assessOutboundCredit` preflight,
// run BEFORE the carrier call; `chargeMessageCredits` always fully applies.
// ===========================================================================

export type ChargeDirection = "inbound" | "outbound";

export type ChargeReason =
  | "outbound_charge"
  | "inbound_charge"
  | "campaign_charge";

export interface ChargeMessageCreditsInput {
  tenantId: number;
  direction: ChargeDirection;
  body: string;
  mediaCount?: number;
  forceMms?: boolean;
  /** Idempotency key, e.g. `outbound:<messageId>`, `inbound:<sid>`. */
  idempotencyKey: string;
  reason: ChargeReason;
  messageId?: number | null;
  campaignMessageId?: number | null;
  externalId?: string | null;
}

export interface BucketBalances {
  includedRemaining: number;
  addon: number;
  backup: number;
  debt: number;
}

export interface ChargeResult {
  /** True when this call moved credits (a fresh charge). */
  charged: boolean;
  /** True when the idempotency key already existed (no-op replay). */
  duplicate: boolean;
  /** True when skipped because the message was already refunded/rejected. */
  skipped: boolean;
  /** True for enterprise/unlimited tenants (recorded but free). */
  unlimited: boolean;
  credits: number;
  channel: MessageChannel;
  includedDelta: number;
  addonDelta: number;
  backupDelta: number;
  debtDelta: number;
  balanceAfter: BucketBalances;
}

interface TenantRow {
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
}

interface UsageRow {
  id: number;
  credits_included: number;
  included_credits_used: number;
  backup_topups_count: number;
  period_start: Date;
}

function isUnlimitedTier(t: Pick<TenantRow, "plan_tier_code" | "tier_code">): boolean {
  return (t.plan_tier_code ?? t.tier_code) === "enterprise";
}

/**
 * Charge (or refund-guard / replay) the credits for a single message inside one
 * locked transaction. Inbound never throws on shortfall (debt accrues). Safe to
 * call multiple times with the same idempotencyKey — only the first applies.
 */
export async function chargeMessageCredits(
  input: ChargeMessageCreditsInput,
): Promise<ChargeResult> {
  const {
    tenantId,
    direction,
    idempotencyKey,
    reason,
    messageId = null,
    campaignMessageId = null,
    externalId = null,
  } = input;

  const cost = calculateMessageCredits({
    body: input.body,
    mediaCount: input.mediaCount,
    forceMms: input.forceMms,
  });
  const credits = cost.credits;
  const channel = cost.channel;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Lock the tenant row — serializes every charge for this tenant so the
    //    waterfall math and the ledger insert can never interleave.
    const tr = await client.query<TenantRow>(
      `SELECT id, plan_tier_code, tier_code, addon_credits, backup_credits,
              credit_debt, backup_enabled, backup_topup_cap_per_cycle,
              prepaid_credits, credit_buckets_migrated_at
         FROM tenants WHERE id = $1 FOR UPDATE`,
      [tenantId],
    );
    if (tr.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new Error(`chargeMessageCredits: tenant ${tenantId} not found`);
    }
    const t = tr.rows[0];

    // 2. Idempotency: a row for this (tenant, key, reason) means already done.
    const existing = await client.query(
      `SELECT included_delta, addon_delta, backup_delta, debt_delta, credits,
              channel, status, included_remaining_after, addon_after,
              backup_after, debt_after
         FROM credit_ledger
        WHERE tenant_id = $1 AND idempotency_key = $2 AND reason = $3
        LIMIT 1`,
      [tenantId, idempotencyKey, reason],
    );
    if (existing.rows.length > 0) {
      const r = existing.rows[0];
      await client.query("COMMIT");
      return {
        charged: false,
        duplicate: true,
        skipped: r.status === "skipped_rejected",
        unlimited: r.status === "unlimited",
        credits: r.credits,
        channel: (r.channel as MessageChannel) ?? channel,
        includedDelta: r.included_delta,
        addonDelta: r.addon_delta,
        backupDelta: r.backup_delta,
        debtDelta: r.debt_delta,
        balanceAfter: {
          includedRemaining: r.included_remaining_after ?? 0,
          addon: r.addon_after ?? t.addon_credits,
          backup: r.backup_after ?? t.backup_credits,
          debt: r.debt_after ?? t.credit_debt,
        },
      };
    }

    // 3. Refund-before-charge guard: if a refund (or a pending marker) already
    //    landed for this message OR campaign message (the carrier rejected it
    //    before we charged), do not charge. guardCol is a fixed, code-chosen
    //    column name (never user input) so the interpolation is injection-safe.
    const guardCol =
      messageId != null
        ? "message_id"
        : campaignMessageId != null
          ? "campaign_message_id"
          : null;
    const guardId = messageId ?? campaignMessageId;
    if (guardCol != null) {
      const refunded = await client.query(
        `SELECT 1 FROM credit_ledger
          WHERE tenant_id = $1 AND ${guardCol} = $2
            AND reason IN ('refund_rejected', 'pending_refund')
          LIMIT 1`,
        [tenantId, guardId],
      );
      if (refunded.rows.length > 0) {
        await client.query(
          `INSERT INTO credit_ledger
             (tenant_id, idempotency_key, reason, direction, channel, credits,
              message_id, campaign_message_id, external_id, status, metadata)
           VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,'skipped_rejected',$9)
           ON CONFLICT (tenant_id, idempotency_key, reason) DO NOTHING`,
          [
            tenantId,
            idempotencyKey,
            reason,
            direction,
            channel,
            messageId,
            campaignMessageId,
            externalId,
            JSON.stringify({ skipped: "refund_before_charge" }),
          ],
        );
        await client.query("COMMIT");
        return zeroResult({ skipped: true, channel, t });
      }
    }

    // 4. Enterprise unlimited OR a zero-cost message: record an audit-only row.
    if (isUnlimitedTier(t) || credits === 0) {
      const status = isUnlimitedTier(t) ? "unlimited" : "applied";
      await client.query(
        `INSERT INTO credit_ledger
           (tenant_id, idempotency_key, reason, direction, channel, credits,
            message_id, campaign_message_id, external_id, status,
            addon_after, backup_after, debt_after)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (tenant_id, idempotency_key, reason) DO NOTHING`,
        [
          tenantId,
          idempotencyKey,
          reason,
          direction,
          channel,
          credits,
          messageId,
          campaignMessageId,
          externalId,
          status,
          t.addon_credits,
          t.backup_credits,
          t.credit_debt,
        ],
      );
      await client.query("COMMIT");
      return zeroResult({
        unlimited: isUnlimitedTier(t),
        credits,
        channel,
        t,
      });
    }

    // 5. Lazy one-time migration of the legacy prepaidCredits balance.
    const migrate = t.credit_buckets_migrated_at == null;
    const addon0 = t.addon_credits + (migrate ? t.prepaid_credits : 0);
    const backup0 = t.backup_credits;
    const debt0 = t.credit_debt;

    // 6. Lock the active usage record (the per-cycle Included bucket).
    const ur = await client.query<UsageRow>(
      `SELECT id, credits_included, included_credits_used, backup_topups_count,
              period_start
         FROM usage_records
        WHERE tenant_id = $1 AND period_start <= NOW() AND period_end >= NOW()
        ORDER BY period_start DESC
        LIMIT 1
        FOR UPDATE`,
      [tenantId],
    );
    const usage = ur.rows[0] ?? null;
    const includedRemaining0 = usage
      ? Math.max(0, usage.credits_included - usage.included_credits_used)
      : 0;

    // 7. Strict waterfall drain: Included → Add-On → Backup.
    let remaining = credits;
    const drawIncluded = Math.min(remaining, includedRemaining0);
    remaining -= drawIncluded;
    const drawAddon = Math.min(remaining, addon0);
    remaining -= drawAddon;
    const drawBackup = Math.min(remaining, backup0);
    remaining -= drawBackup;

    // 8. OUTBOUND backup auto-replenish (only when a usage record exists so the
    //    per-cycle cap is enforceable). Buys 250-credit blocks up to the cap.
    let topupBlocks = 0;
    let topupCredits = 0;
    let topupAmountCents = 0;
    let extraBackupDraw = 0;
    if (remaining > 0 && direction === "outbound" && t.backup_enabled && usage) {
      const cap = t.backup_topup_cap_per_cycle ?? 0;
      const blocksAvailable = Math.max(0, cap - usage.backup_topups_count);
      const blocksNeeded = Math.ceil(remaining / BACKUP_BLOCK_SIZE);
      const blocksToBuy = Math.min(blocksNeeded, blocksAvailable);
      if (blocksToBuy > 0) {
        const auth = await authorizeBackupTopup({
          tenantId,
          blocks: blocksToBuy,
          idempotencyKey,
        });
        if (auth.authorized) {
          topupBlocks = blocksToBuy;
          topupCredits = auth.credits;
          topupAmountCents = auth.amountCents;
          extraBackupDraw = Math.min(remaining, topupCredits);
          remaining -= extraBackupDraw;
        }
      }
    }

    // 9. Any remainder accrues as debt (inbound always; outbound only as a
    //    last-resort post-send race — the preflight gate should prevent it).
    const debtDelta = remaining;
    if (debtDelta > 0 && direction === "outbound") {
      logger.warn(
        { tenantId, messageId, shortfall: debtDelta },
        "Outbound charge exceeded coverage post-send; applied to debt",
      );
    }

    const newAddon = addon0 - drawAddon;
    const newBackup = backup0 - drawBackup + topupCredits - extraBackupDraw;
    const newDebt = debt0 + debtDelta;
    const includedRemainingAfter = includedRemaining0 - drawIncluded;

    const includedDelta = -drawIncluded;
    const addonDelta = -drawAddon;
    const backupDelta = topupCredits - (drawBackup + extraBackupDraw);

    // 10. Backup top-up audit row (separate ledger entry for the money in).
    if (topupCredits > 0) {
      await client.query(
        `INSERT INTO credit_ledger
           (tenant_id, idempotency_key, reason, direction, channel, credits,
            backup_delta, backup_after, external_id, status, metadata,
            period_start)
         VALUES ($1,$2,'backup_topup',NULL,NULL,$3,$4,$5,$6,'applied',$7,$8)
         ON CONFLICT (tenant_id, idempotency_key, reason) DO NOTHING`,
        [
          tenantId,
          `topup:${idempotencyKey}`,
          topupCredits,
          topupCredits,
          backup0 - drawBackup + topupCredits,
          externalId,
          JSON.stringify({
            blocks: topupBlocks,
            amountCents: topupAmountCents,
            triggeredBy: idempotencyKey,
          }),
          usage?.period_start ?? null,
        ],
      );
    }

    // 11. The charge ledger row (race-safe via the unique index).
    const inserted = await client.query(
      `INSERT INTO credit_ledger
         (tenant_id, idempotency_key, reason, direction, channel, credits,
          included_delta, addon_delta, backup_delta, debt_delta,
          included_remaining_after, addon_after, backup_after, debt_after,
          message_id, campaign_message_id, external_id, period_start, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'applied')
       ON CONFLICT (tenant_id, idempotency_key, reason) DO NOTHING
       RETURNING id`,
      [
        tenantId,
        idempotencyKey,
        reason,
        direction,
        channel,
        credits,
        includedDelta,
        addonDelta,
        backupDelta,
        debtDelta,
        includedRemainingAfter,
        newAddon,
        newBackup,
        newDebt,
        messageId,
        campaignMessageId,
        externalId,
        usage?.period_start ?? null,
      ],
    );

    // Lost a concurrent race on the same key — the other txn applied it.
    if (inserted.rows.length === 0) {
      await client.query("ROLLBACK");
      return chargeMessageCredits(input);
    }

    // 12. Materialize the new balances.
    await client.query(
      `UPDATE tenants
          SET addon_credits = $2,
              backup_credits = $3,
              credit_debt = $4,
              prepaid_credits = CASE WHEN $5 THEN 0 ELSE prepaid_credits END,
              credit_buckets_migrated_at = COALESCE(credit_buckets_migrated_at, NOW())
        WHERE id = $1`,
      [tenantId, newAddon, newBackup, newDebt, migrate],
    );

    if (usage) {
      await client.query(
        `UPDATE usage_records
            SET included_credits_used = included_credits_used + $2,
                credits_used = credits_used + $3,
                messages_sent = messages_sent + 1,
                backup_topups_count = backup_topups_count + $4,
                backup_topup_credits = backup_topup_credits + $5,
                backup_topup_amount_cents = backup_topup_amount_cents + $6
          WHERE id = $1`,
        [
          usage.id,
          drawIncluded,
          credits,
          topupBlocks,
          topupCredits,
          topupAmountCents,
        ],
      );
    }

    await client.query("COMMIT");

    return {
      charged: true,
      duplicate: false,
      skipped: false,
      unlimited: false,
      credits,
      channel,
      includedDelta,
      addonDelta,
      backupDelta,
      debtDelta,
      balanceAfter: {
        includedRemaining: includedRemainingAfter,
        addon: newAddon,
        backup: newBackup,
        debt: newDebt,
      },
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already broken — nothing to roll back */
    }
    throw err;
  } finally {
    client.release();
  }
}

export interface RefundResult {
  /** True when this call moved credits back (a fresh refund). */
  refunded: boolean;
  /** True when a refund for this message already existed (no-op replay). */
  duplicate: boolean;
  /** True when no charge existed yet so a pending_refund marker was written. */
  pending: boolean;
  /** True when there was nothing to reverse (no charge, or a free/unlimited charge). */
  noCharge: boolean;
  /** Credits returned to the tenant's buckets. */
  credits: number;
}

/**
 * Reverse the credit charge for a single OUTBOUND message the carrier REJECTED
 * (Twilio 21610 / 21211). Idempotent on (tenant, message, reason). A confirmed
 * FAILURE (30007 / 30003) must NOT call this — that charge stands.
 *
 * Reverses ONLY the message CONSUMPTION (Included → Add-On → Backup draw + any
 * accrued debt). A Backup top-up PURCHASE made to cover the message is real
 * money already spent, so those credits STAY in the Backup bucket.
 *
 * Fast-callback-before-charge race: if the rejection lands before the charge was
 * written, we record a `pending_refund` marker (conversation messages only,
 * keyed on message_id) so the later chargeMessageCredits no-ops (skipped).
 */
export async function refundMessageCredits(input: {
  tenantId: number;
  messageId?: number | null;
  campaignMessageId?: number | null;
  externalId?: string | null;
  idempotencyKey?: string;
}): Promise<RefundResult> {
  const {
    tenantId,
    messageId = null,
    campaignMessageId = null,
    externalId = null,
  } = input;

  if (messageId == null && campaignMessageId == null) {
    return { refunded: false, duplicate: false, pending: false, noCharge: true, credits: 0 };
  }

  const targetCol = messageId != null ? "message_id" : "campaign_message_id";
  const targetId = messageId ?? campaignMessageId;
  const idemKey =
    input.idempotencyKey ??
    (messageId != null
      ? `refund:message:${messageId}`
      : `refund:campaign_message:${campaignMessageId}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the tenant row — serialize with any concurrent charge for this tenant.
    const tr = await client.query<
      Pick<TenantRow, "id" | "addon_credits" | "backup_credits" | "credit_debt">
    >(
      `SELECT id, addon_credits, backup_credits, credit_debt
         FROM tenants WHERE id = $1 FOR UPDATE`,
      [tenantId],
    );
    if (tr.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new Error(`refundMessageCredits: tenant ${tenantId} not found`);
    }
    const t = tr.rows[0];

    // 1. Idempotency: a refund for this message already exists → no-op.
    const refundExisting = await client.query<{ credits: number }>(
      `SELECT credits FROM credit_ledger
        WHERE tenant_id = $1 AND reason = 'refund_rejected' AND ${targetCol} = $2
        LIMIT 1`,
      [tenantId, targetId],
    );
    if (refundExisting.rows.length > 0) {
      await client.query("COMMIT");
      return {
        refunded: false,
        duplicate: true,
        pending: false,
        noCharge: false,
        credits: Math.abs(refundExisting.rows[0].credits ?? 0),
      };
    }

    // 2. Find the original charge for this message (any status).
    const chargeRows = await client.query<{
      id: number;
      direction: ChargeDirection;
      channel: MessageChannel;
      credits: number;
      included_delta: number;
      addon_delta: number;
      backup_delta: number;
      debt_delta: number;
      status: string;
      period_start: Date | null;
    }>(
      `SELECT id, direction, channel, credits, included_delta, addon_delta,
              backup_delta, debt_delta, status, period_start
         FROM credit_ledger
        WHERE tenant_id = $1
          AND reason IN ('outbound_charge', 'campaign_charge')
          AND ${targetCol} = $2
        ORDER BY id DESC
        LIMIT 1`,
      [tenantId, targetId],
    );

    // 3a. No charge yet → fast-callback-before-charge. Mark pending so the later
    //     charge no-ops. The chargeMessageCredits refund guard keys on
    //     message_id OR campaign_message_id, so write the marker on whichever
    //     identifier this refund targets (campaign sends can also have their
    //     status callback race ahead of the inline charge under load).
    if (chargeRows.rows.length === 0) {
      const pendingCol = messageId != null ? "message_id" : "campaign_message_id";
      const pendingKey =
        messageId != null
          ? `pending_refund:message:${messageId}`
          : `pending_refund:campaign_message:${campaignMessageId}`;
      await client.query(
        `INSERT INTO credit_ledger
           (tenant_id, idempotency_key, reason, direction, channel, credits,
            ${pendingCol}, external_id, status, metadata)
         VALUES ($1,$2,'pending_refund','outbound',NULL,0,$3,$4,'applied',$5)
         ON CONFLICT (tenant_id, idempotency_key, reason) DO NOTHING`,
        [
          tenantId,
          pendingKey,
          targetId,
          externalId,
          JSON.stringify({ reason: "carrier_rejected_before_charge" }),
        ],
      );
      await client.query("COMMIT");
      return { refunded: false, duplicate: false, pending: true, noCharge: false, credits: 0 };
    }

    const charge = chargeRows.rows[0];

    // 3b. The charge was free (enterprise/unlimited) or zero-cost — nothing to
    //     reverse, but it is NOT a "missing charge" so do not write a pending
    //     marker (that would suppress a legitimate future replay).
    if (charge.status !== "applied" || charge.credits === 0) {
      await client.query("COMMIT");
      return { refunded: false, duplicate: false, pending: false, noCharge: true, credits: 0 };
    }

    const origCredits = charge.credits;
    const includedDelta = charge.included_delta ?? 0;
    const addonDelta = charge.addon_delta ?? 0;
    const debtDelta = charge.debt_delta ?? 0;

    // Reverse ONLY the consumption. includedDelta/addonDelta were stored as
    // negative draws; debtDelta as a positive accrual. The consumed-from-Backup
    // amount = origCredits + includedDelta + addonDelta - debtDelta (this nets
    // out any Backup top-up that was purchased — that purchase is NOT reversed).
    const refundIncluded = -includedDelta;
    const refundAddon = -addonDelta;
    const refundDebt = debtDelta;
    const refundBackup = origCredits + includedDelta + addonDelta - debtDelta;

    const newAddon = t.addon_credits + refundAddon;
    const newBackup = t.backup_credits + refundBackup;
    const newDebt = Math.max(0, t.credit_debt - refundDebt);

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO credit_ledger
         (tenant_id, idempotency_key, reason, direction, channel, credits,
          included_delta, addon_delta, backup_delta, debt_delta,
          addon_after, backup_after, debt_after,
          message_id, campaign_message_id, external_id, period_start, status, metadata)
       VALUES ($1,$2,'refund_rejected',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'applied',$17)
       ON CONFLICT (tenant_id, idempotency_key, reason) DO NOTHING
       RETURNING id`,
      [
        tenantId,
        idemKey,
        charge.direction,
        charge.channel,
        // Store the refunded credits as a NEGATIVE so the ledger `credits`
        // column nets to zero across charge (+) and refund (-) for the message.
        -origCredits,
        refundIncluded,
        refundAddon,
        refundBackup,
        -refundDebt,
        newAddon,
        newBackup,
        newDebt,
        messageId,
        campaignMessageId,
        externalId,
        charge.period_start,
        JSON.stringify({ reversedChargeId: charge.id, reason: "carrier_rejected" }),
      ],
    );

    // Lost a race to a concurrent refund on the same key — the other txn did it.
    if (inserted.rows.length === 0) {
      await client.query("ROLLBACK");
      return refundMessageCredits(input);
    }

    // Materialize the restored balances.
    await client.query(
      `UPDATE tenants
          SET addon_credits = $2, backup_credits = $3, credit_debt = $4
        WHERE id = $1`,
      [tenantId, newAddon, newBackup, newDebt],
    );

    // Restore the per-cycle Included usage so the Included bucket re-opens.
    if ((refundIncluded > 0 || origCredits > 0) && charge.period_start != null) {
      await client.query(
        `UPDATE usage_records
            SET included_credits_used = GREATEST(included_credits_used - $2, 0),
                credits_used = GREATEST(credits_used - $3, 0)
          WHERE tenant_id = $1 AND period_start = $4`,
        [tenantId, refundIncluded, origCredits, charge.period_start],
      );
    }

    await client.query("COMMIT");
    return {
      refunded: true,
      duplicate: false,
      pending: false,
      noCharge: false,
      credits: origCredits,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already broken — nothing to roll back */
    }
    throw err;
  } finally {
    client.release();
  }
}

function zeroResult(opts: {
  unlimited?: boolean;
  skipped?: boolean;
  credits?: number;
  channel: MessageChannel;
  t: Pick<TenantRow, "addon_credits" | "backup_credits" | "credit_debt">;
}): ChargeResult {
  return {
    charged: false,
    duplicate: false,
    skipped: opts.skipped ?? false,
    unlimited: opts.unlimited ?? false,
    credits: opts.credits ?? 0,
    channel: opts.channel,
    includedDelta: 0,
    addonDelta: 0,
    backupDelta: 0,
    debtDelta: 0,
    balanceAfter: {
      includedRemaining: 0,
      addon: opts.t.addon_credits,
      backup: opts.t.backup_credits,
      debt: opts.t.credit_debt,
    },
  };
}

// ---------------------------------------------------------------------------
// Read-only outbound preflight — the OUTBOUND HARD-STOP gate. Run BEFORE the
// carrier call. Coverage = Included remaining + Add-On + Backup + the Backup
// the tenant could still auto-replenish this cycle (when enabled + under cap).
// Unlimited tenants always pass. Tenants with no billing context at all (no
// usage record, no buckets, never migrated) are treated as UNMETERED and pass,
// so non-billing flows and fixtures are never frozen by accident.
// ---------------------------------------------------------------------------
export interface OutboundCreditAssessment {
  allowed: boolean;
  unlimited: boolean;
  metered: boolean;
  cost: number;
  channel: MessageChannel;
  includedRemaining: number;
  addon: number;
  backup: number;
  replenishableBackup: number;
  coverage: number;
  shortfall: number;
}

export async function assessOutboundCredit(input: {
  tenantId: number;
  body: string;
  mediaCount?: number;
  forceMms?: boolean;
}): Promise<OutboundCreditAssessment> {
  const cost = calculateMessageCredits({
    body: input.body,
    mediaCount: input.mediaCount,
    forceMms: input.forceMms,
  });

  const tr = await pool.query<TenantRow>(
    `SELECT id, plan_tier_code, tier_code, addon_credits, backup_credits,
            credit_debt, backup_enabled, backup_topup_cap_per_cycle,
            prepaid_credits, credit_buckets_migrated_at
       FROM tenants WHERE id = $1 LIMIT 1`,
    [input.tenantId],
  );
  if (tr.rows.length === 0) {
    return blockedAssessment(cost.credits, cost.channel);
  }
  const t = tr.rows[0];

  if (isUnlimitedTier(t)) {
    return {
      allowed: true,
      unlimited: true,
      metered: false,
      cost: cost.credits,
      channel: cost.channel,
      includedRemaining: Infinity,
      addon: t.addon_credits,
      backup: t.backup_credits,
      replenishableBackup: 0,
      coverage: Infinity,
      shortfall: 0,
    };
  }

  const addon = t.addon_credits + (t.credit_buckets_migrated_at == null ? t.prepaid_credits : 0);
  const backup = t.backup_credits;

  const ur = await pool.query<UsageRow>(
    `SELECT id, credits_included, included_credits_used, backup_topups_count,
            period_start
       FROM usage_records
      WHERE tenant_id = $1 AND period_start <= NOW() AND period_end >= NOW()
      ORDER BY period_start DESC
      LIMIT 1`,
    [input.tenantId],
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

  // A tenant with no active usage record AND no credit history is unmetered.
  const metered =
    usage != null ||
    t.credit_buckets_migrated_at != null ||
    addon > 0 ||
    backup > 0 ||
    t.prepaid_credits > 0;

  const coverage = includedRemaining + addon + backup + replenishableBackup;
  const shortfall = Math.max(0, cost.credits - coverage);
  const allowed = !metered || shortfall === 0;

  return {
    allowed,
    unlimited: false,
    metered,
    cost: cost.credits,
    channel: cost.channel,
    includedRemaining,
    addon,
    backup,
    replenishableBackup,
    coverage,
    shortfall,
  };
}

function blockedAssessment(cost: number, channel: MessageChannel): OutboundCreditAssessment {
  return {
    allowed: false,
    unlimited: false,
    metered: true,
    cost,
    channel,
    includedRemaining: 0,
    addon: 0,
    backup: 0,
    replenishableBackup: 0,
    coverage: 0,
    shortfall: cost,
  };
}
