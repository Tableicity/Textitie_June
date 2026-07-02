---
name: Auto-recharge (off-session backup-credit top-up) money-safety
description: Non-obvious contracts for the auto-recharge worker that charges a saved card off-session when credit balance is low, and how it replaced inline replenish.
---

# Auto-recharge — off-session backup-credit top-up

When a tenant's spendable balance (Included remaining + Add-On + Backup) drops to
`autoRechargeThresholdCredits`, an OFF-hot-path worker charges the saved card
off-session via Stripe for "backup credits" ($0.04/credit, 250-credit blocks =
$10/block) and grants them into `tenants.backupCredits`. Core: `autoRecharge.ts`
(claim/charge/grant/breaker), `backupTopupProvider.ts` (Stripe seam),
`grantBackupCredits` in `creditEngine.ts`, routes in `billing.ts`, UI in
`user-app/.../onboarding/Credits.tsx`.

## Non-obvious money-safety contracts
- **The inline backup replenish is PERMANENTLY DISABLED, not deleted.**
  `authorizeBackupTopup` now always returns `authorized:false`
  (`declineReason:"inline_replenish_disabled"`), so the block-purchase branch
  still inside `chargeMessageCredits` never fires and an outbound shortfall falls
  through to debt. ALL top-ups now happen off the send path via auto-recharge.
  **Why:** buying a card on the hot inbound/send path is latency + a card charge
  we can't cleanly reconcile mid-transaction.
  **How to apply:** any test asserting an inline 250-block purchase inside
  `chargeMessageCredits` is testing removed behavior — expect debt instead.

- **Coverage preflight must EXCLUDE the recharge when it can't fire right now.**
  `replenishableBackup` (in BOTH `creditEngine.readCoverage` and
  `creditService.assessOutboundCredit`) counts a future recharge toward coverage
  only when enabled + card saved + not suspended **AND** `auto_recharge_next_retry_at`
  is null/past. If you forget the backoff/cooldown check, a send passes preflight
  during a decline-backoff window and lands in `creditDebt` for a recharge that
  cannot happen. Both call sites must stay in lockstep.

- **Idempotency is a 3-part chain, all keyed before Stripe is touched.**
  claim mints `idempotencyKey` (`auto_recharge:<tenantId>:<uuid>`) and persists it
  on the attempt row INSIDE the claim txn (tenants `FOR UPDATE` + in-flight guard +
  cooldown) BEFORE any charge. The Stripe charge runs OUTSIDE all credit txns.
  `grantBackupCredits` is keyed on `stripe:pi:<id>` via the credit_ledger unique
  index (ON CONFLICT DO NOTHING). A soft/thrown charge error leaves the attempt
  `claimed` for the reconciler to RE-ISSUE with the SAME key (Stripe dedupes → same
  PI). Billing event fires only when `grant.granted`, so replays never double-log.

- **Breaker asymmetry:** a hard decline suspends the tenant IMMEDIATELY (decline
  count also bumps). Soft/timeout failures accrue toward `MAX_DECLINES=3` via the
  reconciler backoff (1h/4h/24h) and suspend at 3. Re-enabling from the UI clears
  the breaker (suspendedAt + declineCount reset). Never charges a stub customer
  (`isRealCustomer` requires `cus_` prefix and not `cus_stub`).

## Known scope boundary (deliberate)
- **reconcile giveup can strand a real charge in a pathological case.** After
  `CLAIM_GIVEUP_MS` (60min) of only soft results, the reconciler fails the attempt
  assuming a same-key re-issue would have surfaced the succeeded PI. If Stripe
  created the PI but EVERY response was lost for the whole window, the tenant was
  charged with no credits granted, and a later NEW claim mints a NEW key → a second
  charge. Very low probability; the hardening (require ≥1 definitive Stripe response
  or a PI lookup-by-metadata before giving up) is deferred. Also: the reconcile
  sweep is `LIMIT 50` with no ORDER BY (fine at current tenant counts).
