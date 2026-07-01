import type Stripe from "stripe";
import { logger } from "./logger";
import { getUncachableStripeClient } from "./stripeClient";

// ---------------------------------------------------------------------------
// Backup credit money-movement seam. Backup credits are sold in fixed
// 250-credit blocks at $0.04/credit ($10.00/block).
//
// TWO paths historically wanted to buy Backup credits:
//   1. The INLINE emergency replenish inside chargeMessageCredits' locked txn.
//      This is now NEUTRALIZED (`authorizeBackupTopup` always declines) — a
//      real Stripe call must NEVER run inside that transaction, and the old
//      stub minted FREE credits (a go-live blocker). Real money now only moves
//      via path 2.
//   2. The OFF-hot-path "auto-recharge" worker (`autoRecharge.ts`), which calls
//      `chargeBackupTopupOffSession` against the tenant's saved card OUTSIDE any
//      credit transaction.
//
// Tests mock this module (it is an external seam) to simulate declines.
// ---------------------------------------------------------------------------

/** Credits granted per Backup block. */
export const BACKUP_BLOCK_SIZE = 250;
/** $0.04/credit × 250 = $10.00 per block. */
export const BACKUP_BLOCK_PRICE_CENTS = BACKUP_BLOCK_SIZE * 4;

export interface AuthorizeBackupTopupInput {
  tenantId: number;
  /** Number of 250-credit blocks to authorize. */
  blocks: number;
  /** Stable key for the triggering charge, so a real provider can dedupe. */
  idempotencyKey?: string;
}

export interface AuthorizeBackupTopupResult {
  authorized: boolean;
  /** Credits actually granted (blocks × BACKUP_BLOCK_SIZE). */
  credits: number;
  /** Amount charged in cents (blocks × BACKUP_BLOCK_PRICE_CENTS). */
  amountCents: number;
  declineReason?: string;
}

/**
 * NEUTRALIZED inline replenish. The former stub authorized any positive block
 * request and the engine granted credits WITHOUT charging — free money. It now
 * always declines so the inline path in chargeMessageCredits can never mint
 * credits. Real Backup purchases go through `chargeBackupTopupOffSession` on the
 * off-hot-path auto-recharge worker.
 */
export async function authorizeBackupTopup(
  input: AuthorizeBackupTopupInput,
): Promise<AuthorizeBackupTopupResult> {
  logger.warn(
    { tenantId: input.tenantId, blocks: input.blocks },
    "Inline backup replenish is disabled; use auto-recharge (off-session) instead",
  );
  return {
    authorized: false,
    credits: 0,
    amountCents: 0,
    declineReason: "inline_replenish_disabled",
  };
}

export interface ChargeBackupTopupOffSessionInput {
  tenantId: number;
  /** Number of 250-credit blocks to charge for. */
  blocks: number;
  /** Stripe PaymentIntent idempotency key (stored on the attempt row). */
  idempotencyKey: string;
  /** Stripe customer to charge. */
  customerId: string;
  /** Saved payment method to charge off-session. */
  paymentMethodId: string;
}

export interface ChargeBackupTopupOffSessionResult {
  authorized: boolean;
  paymentIntentId?: string;
  /** Credits purchased on success (blocks × BACKUP_BLOCK_SIZE). */
  credits: number;
  /** Amount actually confirmed in cents (from the PaymentIntent when available). */
  amountCents: number;
  declineReason?: string;
  /**
   * True only for a DEFINITIVE card decline (StripeCardError / requires action).
   * A network/unknown error leaves this false so the caller keeps the attempt
   * "claimed" and lets the reconciler re-issue with the same idempotency key.
   */
  hardDecline: boolean;
}

/**
 * Charge the tenant's saved card OFF-SESSION for `blocks` Backup blocks and
 * confirm immediately. Returns authorized:true only when Stripe reports the
 * PaymentIntent `succeeded` with the exact expected amount (fail-closed).
 *
 * MUST be called OUTSIDE any credit transaction. The caller stores
 * `idempotencyKey` before calling so a crash/retry re-issues the same key and
 * Stripe dedupes the charge.
 */
export async function chargeBackupTopupOffSession(
  input: ChargeBackupTopupOffSessionInput,
): Promise<ChargeBackupTopupOffSessionResult> {
  const blocks = Math.max(0, Math.floor(input.blocks));
  if (blocks <= 0) {
    return { authorized: false, credits: 0, amountCents: 0, declineReason: "no_blocks", hardDecline: true };
  }

  const expectedCredits = blocks * BACKUP_BLOCK_SIZE;
  const expectedCents = blocks * BACKUP_BLOCK_PRICE_CENTS;

  const stripe = await getUncachableStripeClient();

  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.create(
      {
        amount: expectedCents,
        currency: "usd",
        customer: input.customerId,
        payment_method: input.paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          kind: "auto_recharge_backup",
          tenantId: String(input.tenantId),
          blocks: String(blocks),
          credits: String(expectedCredits),
        },
      },
      { idempotencyKey: input.idempotencyKey },
    );
  } catch (err) {
    // Stripe throws StripeCardError on an off-session decline — that is
    // DEFINITIVE (no charge occurred), so the caller should record a failure.
    const e = err as { type?: string; code?: string; message?: string; raw?: { code?: string } };
    const isCardError = e?.type === "StripeCardError";
    const declineReason = e?.code || e?.raw?.code || e?.message || "charge_error";
    logger.warn(
      { tenantId: input.tenantId, blocks, isCardError, declineReason },
      "Backup off-session charge failed",
    );
    return {
      authorized: false,
      credits: 0,
      amountCents: 0,
      declineReason,
      // Only a card error is definitive. Any other throw is unknown → soft.
      hardDecline: isCardError,
    };
  }

  if (pi.status !== "succeeded") {
    // e.g. requires_action / requires_payment_method — not usable off-session.
    logger.warn(
      { tenantId: input.tenantId, paymentIntentId: pi.id, status: pi.status },
      "Backup off-session charge not succeeded",
    );
    return {
      authorized: false,
      paymentIntentId: pi.id,
      credits: 0,
      amountCents: 0,
      declineReason: `pi_${pi.status}`,
      hardDecline: true,
    };
  }

  // Fail-closed amount check: the confirmed amount must match what we quoted.
  const confirmed = typeof pi.amount_received === "number" ? pi.amount_received : pi.amount;
  if (confirmed !== expectedCents) {
    logger.error(
      { tenantId: input.tenantId, paymentIntentId: pi.id, confirmed, expectedCents },
      "Backup off-session charge amount mismatch — refusing to grant",
    );
    return {
      authorized: false,
      paymentIntentId: pi.id,
      credits: 0,
      amountCents: confirmed,
      declineReason: "amount_mismatch",
      hardDecline: true,
    };
  }

  return {
    authorized: true,
    paymentIntentId: pi.id,
    credits: expectedCredits,
    amountCents: confirmed,
    hardDecline: false,
  };
}
