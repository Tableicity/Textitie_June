import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { pool, db, tenantsTable, billingEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { getUncachableStripeClient } from "./stripeClient";
import { ensureStripeCustomerId } from "./stripeCheckout";
import { grantBackupCredits } from "./creditEngine";
import {
  chargeBackupTopupOffSession,
  BACKUP_BLOCK_SIZE,
  BACKUP_BLOCK_PRICE_CENTS,
} from "./backupTopupProvider";

// ---------------------------------------------------------------------------
// Automatic backup credits (auto-recharge).
//
// When a tenant's effective available balance (Included remaining + Add-On +
// Backup) drops to their configured threshold, an OFF-hot-path worker charges
// the saved card off-session for `autoRechargeAmountCredits` worth of BACKUP
// credits ($0.04/credit, 250-credit blocks) and grants them.
//
// Money-safety contract:
//  - The Stripe call NEVER runs inside a credit transaction.
//  - Exactly one recharge per low episode: a claim under `tenants` FOR UPDATE +
//    the attempts table + a cooldown + an in-flight guard. The idempotency key
//    is minted at claim time and passed to Stripe, so a crash/retry re-issues
//    the SAME key and Stripe dedupes → never a double charge.
//  - Grant is keyed on `stripe:pi:<id>` and only runs after a fail-closed amount
//    check inside chargeBackupTopupOffSession.
//  - A DEFINITIVE decline finalizes the attempt failed, counts toward the
//    breaker (backoff + suspend after MAX_DECLINES). A soft/unknown error leaves
//    the attempt "claimed" for the reconciler to finalize with the same key.
// ---------------------------------------------------------------------------

/** Minimum spacing between recharge attempts (success or fail) for one tenant. */
const COOLDOWN_MS = 5 * 60_000;
/** Consecutive failures before auto-recharge is suspended (owner must re-enable). */
const MAX_DECLINES = 3;
/** A "claimed" attempt older than this is considered stale and reconciled. */
const RECONCILE_STALE_MS = 2 * 60_000;
/** After this long a still-unconfirmed claim is given up (charge never landed). */
const CLAIM_GIVEUP_MS = 60 * 60_000;
/** Sane ceiling for a single recharge amount (before per-cycle cap clamping). */
const MAX_AMOUNT_CREDITS = 50_000;

export class AutoRechargeValidationError extends Error {}

export interface AutoRechargeSettings {
  enabled: boolean;
  thresholdCredits: number;
  amountCredits: number;
  hasPaymentMethod: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  suspendedAt: string | null;
  declineCount: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  nextRetryAt: string | null;
  blockSizeCredits: number;
  blockPriceCents: number;
}

interface TenantAutoRow {
  id: number;
  slug: string;
  stripe_customer_id: string | null;
  auto_recharge_enabled: boolean;
  auto_recharge_threshold_credits: number;
  auto_recharge_amount_credits: number;
  auto_recharge_payment_method_id: string | null;
  auto_recharge_card_brand: string | null;
  auto_recharge_card_last4: string | null;
  auto_recharge_card_exp_month: number | null;
  auto_recharge_card_exp_year: number | null;
  auto_recharge_last_attempt_at: Date | null;
  auto_recharge_last_success_at: Date | null;
  auto_recharge_last_failure_at: Date | null;
  auto_recharge_last_failure_reason: string | null;
  auto_recharge_decline_count: number;
  auto_recharge_suspended_at: Date | null;
  auto_recharge_next_retry_at: Date | null;
  backup_topup_cap_per_cycle: number;
  addon_credits: number;
  backup_credits: number;
  prepaid_credits: number;
  credit_buckets_migrated_at: Date | null;
}

const TENANT_AUTO_COLS = `
  id, slug, stripe_customer_id,
  auto_recharge_enabled, auto_recharge_threshold_credits, auto_recharge_amount_credits,
  auto_recharge_payment_method_id, auto_recharge_card_brand, auto_recharge_card_last4,
  auto_recharge_card_exp_month, auto_recharge_card_exp_year,
  auto_recharge_last_attempt_at, auto_recharge_last_success_at, auto_recharge_last_failure_at,
  auto_recharge_last_failure_reason, auto_recharge_decline_count,
  auto_recharge_suspended_at, auto_recharge_next_retry_at,
  backup_topup_cap_per_cycle, addon_credits, backup_credits, prepaid_credits,
  credit_buckets_migrated_at`;

function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function toSettings(t: TenantAutoRow): AutoRechargeSettings {
  return {
    enabled: t.auto_recharge_enabled,
    thresholdCredits: t.auto_recharge_threshold_credits,
    amountCredits: t.auto_recharge_amount_credits,
    hasPaymentMethod: !!t.auto_recharge_payment_method_id,
    cardBrand: t.auto_recharge_card_brand,
    cardLast4: t.auto_recharge_card_last4,
    cardExpMonth: t.auto_recharge_card_exp_month,
    cardExpYear: t.auto_recharge_card_exp_year,
    suspendedAt: toIso(t.auto_recharge_suspended_at),
    declineCount: t.auto_recharge_decline_count,
    lastAttemptAt: toIso(t.auto_recharge_last_attempt_at),
    lastSuccessAt: toIso(t.auto_recharge_last_success_at),
    lastFailureAt: toIso(t.auto_recharge_last_failure_at),
    lastFailureReason: t.auto_recharge_last_failure_reason,
    nextRetryAt: toIso(t.auto_recharge_next_retry_at),
    blockSizeCredits: BACKUP_BLOCK_SIZE,
    blockPriceCents: BACKUP_BLOCK_PRICE_CENTS,
  };
}

async function readTenantAuto(tenantId: number): Promise<TenantAutoRow | null> {
  const r = await pool.query<TenantAutoRow>(
    `SELECT ${TENANT_AUTO_COLS} FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId],
  );
  return r.rows[0] ?? null;
}

/** Included remaining for the CURRENT billing period (0 when no active record). */
async function readIncludedRemaining(tenantId: number): Promise<number> {
  const ur = await pool.query<{ credits_included: number; included_credits_used: number }>(
    `SELECT credits_included, included_credits_used
       FROM usage_records
      WHERE tenant_id = $1 AND period_start <= NOW() AND period_end >= NOW()
      ORDER BY period_start DESC
      LIMIT 1`,
    [tenantId],
  );
  const u = ur.rows[0];
  return u ? Math.max(0, u.credits_included - u.included_credits_used) : 0;
}

function effectiveAddon(t: TenantAutoRow): number {
  return t.addon_credits + (t.credit_buckets_migrated_at == null ? t.prepaid_credits : 0);
}

export async function getAutoRechargeSettings(tenantId: number): Promise<AutoRechargeSettings> {
  const t = await readTenantAuto(tenantId);
  if (!t) throw new Error("Tenant not found");
  return toSettings(t);
}

export async function updateAutoRechargeSettings(
  tenantId: number,
  input: { enabled: boolean; thresholdCredits: number; amountCredits: number },
): Promise<AutoRechargeSettings> {
  const { enabled } = input;
  const thresholdCredits = Math.trunc(input.thresholdCredits);
  const amountCredits = Math.trunc(input.amountCredits);

  if (!Number.isFinite(thresholdCredits) || thresholdCredits < 0) {
    throw new AutoRechargeValidationError("Threshold must be a non-negative whole number");
  }
  if (
    !Number.isFinite(amountCredits) ||
    amountCredits < BACKUP_BLOCK_SIZE ||
    amountCredits % BACKUP_BLOCK_SIZE !== 0
  ) {
    throw new AutoRechargeValidationError(
      `Recharge amount must be a multiple of ${BACKUP_BLOCK_SIZE} (minimum ${BACKUP_BLOCK_SIZE})`,
    );
  }
  if (amountCredits > MAX_AMOUNT_CREDITS) {
    throw new AutoRechargeValidationError(
      `Recharge amount cannot exceed ${MAX_AMOUNT_CREDITS.toLocaleString()} credits`,
    );
  }

  const current = await readTenantAuto(tenantId);
  if (!current) throw new Error("Tenant not found");

  if (enabled && !current.auto_recharge_payment_method_id) {
    throw new AutoRechargeValidationError(
      "Save a card before enabling automatic backup credits",
    );
  }

  // Enabling is a fresh start: clear any prior suspension / decline backoff so a
  // tenant that fixed their card can turn it back on immediately.
  const clearBreaker = enabled;
  await db
    .update(tenantsTable)
    .set({
      autoRechargeEnabled: enabled,
      autoRechargeThresholdCredits: thresholdCredits,
      autoRechargeAmountCredits: amountCredits,
      ...(clearBreaker
        ? {
            autoRechargeSuspendedAt: null,
            autoRechargeDeclineCount: 0,
            autoRechargeNextRetryAt: null,
            autoRechargeLastFailureReason: null,
          }
        : {}),
    })
    .where(eq(tenantsTable.id, tenantId));

  const updated = await readTenantAuto(tenantId);
  return toSettings(updated!);
}

export async function createAutoRechargeSetupSession(
  tenantId: number,
  tenantSlug: string,
  successUrl: string,
  cancelUrl: string,
): Promise<{ checkoutUrl: string; sessionId: string }> {
  const t = await readTenantAuto(tenantId);
  if (!t) throw new Error("Tenant not found");

  const stripe = await getUncachableStripeClient();
  const customerId = await ensureStripeCustomerId(
    stripe,
    tenantId,
    tenantSlug,
    t.stripe_customer_id,
  );

  const meta = { kind: "auto_recharge_setup", tenantId: String(tenantId), tenantSlug };
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "setup",
    payment_method_types: ["card"],
    metadata: meta,
    setup_intent_data: { metadata: meta },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!session.url) throw new Error("Stripe did not return a setup URL");
  logger.info({ tenantId, sessionId: session.id }, "Auto-recharge card setup session created");
  return { checkoutUrl: session.url, sessionId: session.id };
}

/**
 * Webhook fulfillment for a `mode:setup` Checkout session: pin the saved card as
 * the customer's default payment method, store it on the tenant, and clear any
 * suspension so the owner can enable auto-recharge. Idempotent (safe to replay).
 */
export async function handleSetupCheckoutCompleted(sessionId: string): Promise<void> {
  const stripe = await getUncachableStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["setup_intent"],
  });

  if (session.mode !== "setup" || session.metadata?.kind !== "auto_recharge_setup") {
    logger.warn({ sessionId }, "Not an auto-recharge setup session — skipping");
    return;
  }

  const tenantId = Number(session.metadata?.tenantId);
  if (!tenantId) {
    logger.warn({ sessionId }, "Auto-recharge setup missing tenantId — skipping");
    return;
  }

  const setupIntent = session.setup_intent as Stripe.SetupIntent | null;
  const paymentMethodId =
    typeof setupIntent?.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent?.payment_method?.id ?? null;

  if (!paymentMethodId) {
    logger.error({ sessionId, tenantId }, "Auto-recharge setup has no payment method — skipping");
    return;
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  let brand: string | null = null;
  let last4: string | null = null;
  let expMonth: number | null = null;
  let expYear: number | null = null;
  try {
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.card) {
      brand = pm.card.brand ?? null;
      last4 = pm.card.last4 ?? null;
      expMonth = pm.card.exp_month ?? null;
      expYear = pm.card.exp_year ?? null;
    }
  } catch (err) {
    logger.warn({ err, paymentMethodId }, "Could not retrieve saved card details (continuing)");
  }

  if (customerId) {
    try {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    } catch (err) {
      logger.warn({ err, customerId }, "Could not set default payment method (continuing)");
    }
  }

  await db
    .update(tenantsTable)
    .set({
      stripeCustomerId: customerId ?? undefined,
      autoRechargePaymentMethodId: paymentMethodId,
      autoRechargeCardBrand: brand,
      autoRechargeCardLast4: last4,
      autoRechargeCardExpMonth: expMonth,
      autoRechargeCardExpYear: expYear,
      autoRechargeSuspendedAt: null,
      autoRechargeDeclineCount: 0,
      autoRechargeNextRetryAt: null,
      autoRechargeLastFailureReason: null,
    })
    .where(eq(tenantsTable.id, tenantId));

  await db.insert(billingEventsTable).values({
    tenantId,
    eventType: "auto_recharge_card_saved",
    amountCents: 0,
    metadata: JSON.stringify({ sessionId, brand, last4 }),
  });

  logger.info({ tenantId, sessionId, brand, last4 }, "Auto-recharge card saved");
}

interface Claim {
  attemptId: number;
  blocks: number;
  credits: number;
  amountCents: number;
  idempotencyKey: string;
  customerId: string | null;
  paymentMethodId: string;
}

/**
 * Try to CLAIM a recharge under the tenant lock. Returns a claim only when the
 * tenant is eligible AND low AND no attempt is already in flight; otherwise
 * null. The claim writes the attempt row (status 'claimed') + stamps
 * lastAttemptAt inside the same transaction, so concurrent callers race to a
 * single winner.
 */
async function claimRecharge(tenantId: number): Promise<Claim | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tr = await client.query<TenantAutoRow>(
      `SELECT ${TENANT_AUTO_COLS} FROM tenants WHERE id = $1 FOR UPDATE`,
      [tenantId],
    );
    const t = tr.rows[0];
    if (!t) {
      await client.query("ROLLBACK");
      return null;
    }

    const now = Date.now();
    const eligible =
      t.auto_recharge_enabled &&
      !!t.auto_recharge_payment_method_id &&
      t.auto_recharge_suspended_at == null &&
      (t.auto_recharge_next_retry_at == null || t.auto_recharge_next_retry_at.getTime() <= now) &&
      (t.auto_recharge_last_attempt_at == null ||
        now - t.auto_recharge_last_attempt_at.getTime() >= COOLDOWN_MS);
    if (!eligible) {
      await client.query("ROLLBACK");
      return null;
    }

    // In-flight guard: a recent 'claimed' attempt means a charge is already
    // being processed (or awaiting reconcile) — do not start a second.
    const inflight = await client.query(
      `SELECT 1 FROM credit_auto_recharge_attempts
        WHERE tenant_id = $1 AND status = 'claimed'
          AND created_at > NOW() - INTERVAL '${Math.ceil(CLAIM_GIVEUP_MS / 1000)} seconds'
        LIMIT 1`,
      [tenantId],
    );
    if ((inflight.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return null;
    }

    // Balance check (Included remaining + Add-On + Backup).
    const ur = await client.query<{
      credits_included: number;
      included_credits_used: number;
      backup_topups_count: number;
    }>(
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
    const balance = includedRemaining + effectiveAddon(t) + t.backup_credits;
    if (balance > t.auto_recharge_threshold_credits) {
      await client.query("ROLLBACK");
      return null;
    }

    // Clamp the requested amount by the per-cycle cap.
    const cap = t.backup_topup_cap_per_cycle ?? 0;
    const usedBlocks = usage?.backup_topups_count ?? 0;
    const capRemaining = Math.max(0, cap - usedBlocks);
    const wantBlocks = Math.ceil(t.auto_recharge_amount_credits / BACKUP_BLOCK_SIZE);
    const blocks = Math.min(wantBlocks, capRemaining);
    if (blocks <= 0) {
      // Per-cycle cap reached — nothing to buy this cycle.
      await client.query("ROLLBACK");
      return null;
    }

    const credits = blocks * BACKUP_BLOCK_SIZE;
    const amountCents = blocks * BACKUP_BLOCK_PRICE_CENTS;
    const idempotencyKey = `auto_recharge:${tenantId}:${randomUUID()}`;

    const ins = await client.query<{ id: number }>(
      `INSERT INTO credit_auto_recharge_attempts
         (tenant_id, status, blocks, credits, amount_cents, idempotency_key)
       VALUES ($1,'claimed',$2,$3,$4,$5)
       RETURNING id`,
      [tenantId, blocks, credits, amountCents, idempotencyKey],
    );
    await client.query(
      `UPDATE tenants SET auto_recharge_last_attempt_at = NOW() WHERE id = $1`,
      [tenantId],
    );
    await client.query("COMMIT");

    return {
      attemptId: ins.rows[0].id,
      blocks,
      credits,
      amountCents,
      idempotencyKey,
      customerId: t.stripe_customer_id,
      paymentMethodId: t.auto_recharge_payment_method_id!,
    };
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

function backoffMsFor(declineCount: number): number {
  if (declineCount <= 1) return 60 * 60_000; // 1h
  if (declineCount === 2) return 4 * 60 * 60_000; // 4h
  return 24 * 60 * 60_000; // 24h
}

async function finalizeSuccess(
  tenantId: number,
  attemptId: number,
  paymentIntentId: string,
  credits: number,
  blocks: number,
  amountCents: number,
): Promise<void> {
  const grant = await grantBackupCredits(
    tenantId,
    credits,
    blocks,
    amountCents,
    `stripe:pi:${paymentIntentId}`,
    "auto_recharge",
  );

  await pool.query(
    `UPDATE credit_auto_recharge_attempts
        SET status = 'succeeded', payment_intent_id = $2, failure_reason = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [attemptId, paymentIntentId],
  );
  await db
    .update(tenantsTable)
    .set({
      autoRechargeLastSuccessAt: new Date(),
      autoRechargeDeclineCount: 0,
      autoRechargeLastFailureReason: null,
      autoRechargeNextRetryAt: null,
    })
    .where(eq(tenantsTable.id, tenantId));

  if (grant.granted) {
    await db.insert(billingEventsTable).values({
      tenantId,
      eventType: "auto_recharge_succeeded",
      amountCents,
      metadata: JSON.stringify({ paymentIntentId, credits, blocks }),
    });
  }
  logger.info(
    { tenantId, attemptId, paymentIntentId, credits, granted: grant.granted },
    "Auto-recharge succeeded",
  );
}

async function finalizeFailure(
  tenantId: number,
  attemptId: number,
  reason: string,
  hardDecline: boolean,
  paymentIntentId: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE credit_auto_recharge_attempts
        SET status = 'failed', failure_reason = $2, payment_intent_id = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [attemptId, reason, paymentIntentId],
  );

  const t = await readTenantAuto(tenantId);
  const newCount = (t?.auto_recharge_decline_count ?? 0) + 1;
  const suspend = hardDecline || newCount >= MAX_DECLINES;
  const nextRetryAt = suspend ? null : new Date(Date.now() + backoffMsFor(newCount));

  await db
    .update(tenantsTable)
    .set({
      autoRechargeDeclineCount: newCount,
      autoRechargeLastFailureAt: new Date(),
      autoRechargeLastFailureReason: reason,
      autoRechargeNextRetryAt: nextRetryAt,
      autoRechargeSuspendedAt: suspend ? new Date() : t?.auto_recharge_suspended_at ?? null,
    })
    .where(eq(tenantsTable.id, tenantId));

  await db.insert(billingEventsTable).values({
    tenantId,
    eventType: "auto_recharge_failed",
    amountCents: 0,
    metadata: JSON.stringify({ attemptId, reason, hardDecline, suspended: suspend, declineCount: newCount }),
  });

  logger.warn(
    { tenantId, attemptId, reason, hardDecline, suspended: suspend, declineCount: newCount },
    "Auto-recharge failed",
  );
}

function isRealCustomer(id: string | null): id is string {
  return !!id && id.startsWith("cus_") && !id.startsWith("cus_stub");
}

/**
 * Execute a claimed recharge: charge off-session, then grant on success or run
 * the decline breaker on a definitive failure. A soft/unknown error leaves the
 * attempt 'claimed' for the reconciler to finalize with the same idempotency key.
 */
async function executeClaim(tenantId: number, claim: Claim): Promise<void> {
  if (!isRealCustomer(claim.customerId)) {
    await finalizeFailure(tenantId, claim.attemptId, "missing_stripe_customer", true, null);
    return;
  }

  let result;
  try {
    result = await chargeBackupTopupOffSession({
      tenantId,
      blocks: claim.blocks,
      idempotencyKey: claim.idempotencyKey,
      customerId: claim.customerId,
      paymentMethodId: claim.paymentMethodId,
    });
  } catch (err) {
    // Unknown/network error: DO NOT finalize — leave the attempt 'claimed' so the
    // reconciler re-issues with the same key (Stripe dedupes) and we never risk a
    // double charge or a lost grant.
    logger.warn({ err, tenantId, attemptId: claim.attemptId }, "Auto-recharge charge threw — leaving claimed for reconcile");
    return;
  }

  if (result.authorized && result.paymentIntentId) {
    await finalizeSuccess(
      tenantId,
      claim.attemptId,
      result.paymentIntentId,
      claim.credits,
      claim.blocks,
      claim.amountCents,
    );
    return;
  }

  if (result.hardDecline) {
    await finalizeFailure(
      tenantId,
      claim.attemptId,
      result.declineReason ?? "declined",
      true,
      result.paymentIntentId ?? null,
    );
    return;
  }

  // Soft failure: leave claimed for reconcile.
  logger.warn(
    { tenantId, attemptId: claim.attemptId, reason: result.declineReason },
    "Auto-recharge soft failure — leaving claimed for reconcile",
  );
}

/**
 * Off-hot-path entry point: called fire-and-forget after an outbound charge and
 * from the timer sweep. Fast-exits cheaply when the tenant is not eligible/low,
 * then claims + charges. Never throws to the caller.
 */
export async function maybeTriggerAutoRecharge(tenantId: number): Promise<void> {
  try {
    // Cheap non-locking pre-check to avoid taking the tenant lock on every send.
    const t = await readTenantAuto(tenantId);
    if (
      !t ||
      !t.auto_recharge_enabled ||
      !t.auto_recharge_payment_method_id ||
      t.auto_recharge_suspended_at != null
    ) {
      return;
    }
    const now = Date.now();
    if (t.auto_recharge_next_retry_at && t.auto_recharge_next_retry_at.getTime() > now) return;
    if (
      t.auto_recharge_last_attempt_at &&
      now - t.auto_recharge_last_attempt_at.getTime() < COOLDOWN_MS
    ) {
      return;
    }
    const includedRemaining = await readIncludedRemaining(tenantId);
    const balance = includedRemaining + effectiveAddon(t) + t.backup_credits;
    if (balance > t.auto_recharge_threshold_credits) return;

    const claim = await claimRecharge(tenantId);
    if (!claim) return;
    await executeClaim(tenantId, claim);
  } catch (err) {
    logger.error({ err, tenantId }, "maybeTriggerAutoRecharge failed");
  }
}

/**
 * Timer-driven safety net (runs each 60s cycle):
 *  1. Finalize stale 'claimed' attempts by re-issuing the charge with the SAME
 *     idempotency key (Stripe dedupes → confirms the prior charge or reports a
 *     definitive decline). A claim older than CLAIM_GIVEUP is failed.
 *  2. Sweep enabled tenants for a low balance and trigger a recharge — recovers
 *     any missed post-charge trigger.
 * Returns the number of recharge actions taken (finalized + swept-triggered).
 */
export async function reconcileAutoRecharge(): Promise<number> {
  let actions = 0;

  // --- 1. Finalize stale claims -------------------------------------------
  const staleSecs = Math.ceil(RECONCILE_STALE_MS / 1000);
  const stale = await pool.query<{
    id: number;
    tenant_id: number;
    blocks: number;
    credits: number;
    amount_cents: number;
    idempotency_key: string;
    created_at: Date;
  }>(
    `SELECT id, tenant_id, blocks, credits, amount_cents, idempotency_key, created_at
       FROM credit_auto_recharge_attempts
      WHERE status = 'claimed'
        AND updated_at < NOW() - INTERVAL '${staleSecs} seconds'
      ORDER BY created_at ASC
      LIMIT 25`,
  );

  for (const a of stale.rows) {
    const t = await readTenantAuto(a.tenant_id);
    const pm = t?.auto_recharge_payment_method_id ?? null;
    if (!t || !isRealCustomer(t.stripe_customer_id) || !pm) {
      await finalizeFailure(a.tenant_id, a.id, "missing_payment_setup", true, null);
      actions++;
      continue;
    }
    try {
      const result = await chargeBackupTopupOffSession({
        tenantId: a.tenant_id,
        blocks: a.blocks,
        idempotencyKey: a.idempotency_key,
        customerId: t.stripe_customer_id,
        paymentMethodId: pm,
      });
      if (result.authorized && result.paymentIntentId) {
        await finalizeSuccess(a.tenant_id, a.id, result.paymentIntentId, a.credits, a.blocks, a.amount_cents);
        actions++;
      } else if (result.hardDecline) {
        await finalizeFailure(a.tenant_id, a.id, result.declineReason ?? "declined", true, result.paymentIntentId ?? null);
        actions++;
      } else if (Date.now() - a.created_at.getTime() > CLAIM_GIVEUP_MS) {
        // Given up: same-key re-issue still not confirmed → the charge never
        // landed (Stripe would return the succeeded PI otherwise).
        await finalizeFailure(a.tenant_id, a.id, "reconcile_timeout", false, null);
        actions++;
      }
      // else: still soft/unknown and within the give-up window → try again next cycle.
    } catch (err) {
      logger.warn({ err, attemptId: a.id }, "Reconcile re-issue threw — retry next cycle");
    }
  }

  // --- 2. Sweep low-balance enabled tenants -------------------------------
  const enabled = await pool.query<{ id: number }>(
    `SELECT id FROM tenants
      WHERE auto_recharge_enabled = true
        AND auto_recharge_payment_method_id IS NOT NULL
        AND auto_recharge_suspended_at IS NULL
        AND (auto_recharge_next_retry_at IS NULL OR auto_recharge_next_retry_at <= NOW())
        AND (lifecycle_status IS NULL OR lifecycle_status <> 'archived')
      LIMIT 50`,
  );
  for (const row of enabled.rows) {
    await maybeTriggerAutoRecharge(row.id);
  }

  return actions;
}
