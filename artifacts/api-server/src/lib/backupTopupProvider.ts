import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Backup auto-replenish seam. When a tenant's Included + Add-On buckets hit
// zero on an OUTBOUND charge, the engine buys "Backup" credits in fixed
// 250-credit blocks at $0.04/credit ($10.00/block) to keep messages flowing.
//
// The REAL money movement is a Stripe off-session charge against the tenant's
// saved card — that wiring is a LATER phase. For now this is a clean stub that
// authorizes any positive block request. A future implementation calls Stripe
// here and returns { authorized: false } on a decline, which the engine treats
// as an outbound HARD-STOP (the message is not sent / falls through to debt).
//
// Tests mock this module (it is an external seam) to simulate declines.
// ---------------------------------------------------------------------------

/** Credits granted per Backup auto-replenish block. */
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
 * Authorize a Backup auto-replenish purchase. Stub: authorizes any positive
 * block count. Replace the body with a real Stripe off-session charge later.
 */
export async function authorizeBackupTopup(
  input: AuthorizeBackupTopupInput,
): Promise<AuthorizeBackupTopupResult> {
  const blocks = Math.max(0, Math.floor(input.blocks));
  if (blocks <= 0) {
    return { authorized: false, credits: 0, amountCents: 0, declineReason: "no_blocks" };
  }

  const credits = blocks * BACKUP_BLOCK_SIZE;
  const amountCents = blocks * BACKUP_BLOCK_PRICE_CENTS;

  logger.info(
    { tenantId: input.tenantId, blocks, credits, amountCents },
    "Backup auto-replenish authorized (stub)",
  );

  return { authorized: true, credits, amountCents };
}
