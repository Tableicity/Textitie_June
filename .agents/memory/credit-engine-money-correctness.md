---
name: Credit deduction engine — money-correctness boundaries
description: Durable invariants and known scope boundaries of the internal credit charge/refund/waterfall engine (creditService.ts).
---

# Credit deduction engine — money-correctness

The engine charges every live inbound + outbound SMS/MMS against a strict
3-bucket waterfall (Included → Add-On → Backup) idempotently, with refunds.
Core code: `artifacts/api-server/src/lib/creditService.ts`,
`messageCost.ts`, `backupTopupProvider.ts`, refund wiring in `deliveryStatus.ts`.

## Invariants that are easy to break

- **Refund reverses CONSUMPTION only, never the Backup top-up PURCHASE.** The
  consumed-from-Backup amount = `origCredits + includedDelta + addonDelta - debtDelta`
  (included/addon stored as negative draws, debt as positive accrual). The 250-credit
  block that was bought with real money stays.
  **Why:** a carrier rejection should give back what the message consumed, not claw
  back a card charge we already made.

- **The refund-before-charge guard AND the pending_refund marker must key on
  `message_id` OR `campaign_message_id` symmetrically.** A rejection status callback
  can race ahead of the inline charge for *campaign* sends too (under load), not just
  conversation messages. If the guard only covers `message_id`, a fast 21610/21211
  callback on a campaign message no-ops, then the later `campaign_charge` lands and the
  rejected message is charged forever.
  **How to apply:** any new charge path that gets its own ledger identifier needs both
  the guard lookup and the pending marker extended to that column.

- **Ledger INSERT column list count must equal the values array.** A `$N` placeholder
  with no corresponding value throws `bind message supplies M parameters, but prepared
  statement requires N` **only at runtime** — `tsc` does NOT catch it. DB-backed tests
  do. This bit the refund INSERT (a trailing `metadata` `$17` with 16 values supplied).
  **How to apply:** never trust typecheck alone for raw-SQL INSERTs; run the DB-backed
  creditService tests (`creditService.test.ts` / `creditService.decline.test.ts`,
  per-file to dodge the env reaper).

## Known scope boundaries (deliberate, not bugs)

- **Inline backup replenish is now PERMANENTLY DISABLED — top-ups moved off-path.**
  `authorizeBackupTopup` always returns `authorized:false` now, so the block-purchase
  branch inside `chargeMessageCredits` never fires; an outbound shortfall falls through to
  `creditDebt` (never mints phantom credits, never consumes the per-cycle cap). The real
  card charge happens off the send path via **auto-recharge** — see
  [auto-recharge off-session](auto-recharge-offsession.md). The **off** case is still
  enforced at preflight (`assessOutboundCredit` excludes replenishable Backup when
  `backupEnabled=false`), and preflight now also excludes the recharge during a
  decline-backoff window (`auto_recharge_next_retry_at`).

- **Post-send charge failures are best-effort logged — no durable outbox/reconciler.**
  If `chargeMessageCredits` throws after a confirmed carrier send (outbound, campaign) or
  on the fire-and-forget inbound path, the charge is lost. The idempotent ledger keys
  (`unique(tenant_id, idempotency_key, reason)`) make a future reconciler/outbox safe to
  add — that subsystem was out of scope for the engine-build phase. (The auto-recharge
  worker has its OWN reconciler for card top-ups; this note is about the per-message
  consumption ledger, which still has none.)
