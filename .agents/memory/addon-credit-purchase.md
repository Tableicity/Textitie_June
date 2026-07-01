---
name: Add-on credit purchase (real Stripe charge)
description: Money-correctness invariants for buying message credits ("gas") via a real one-time Stripe charge, incl. trial users.
---

# Add-on message-credit purchase — money-correctness invariants

Buying add-on credits ("gas") is a REAL one-time Stripe charge available in ANY
subscription status (including `trialing`). The old free-grant path (a `POST
/campaigns/top-up` route that granted credits for free via `addPrepaidCredits`)
was a money hole and is DELETED — do not reintroduce a free grant anywhere.

## The invariants (all must hold together)
1. **Grant ONLY on the confirmed webhook, never on the success redirect.** The
   `?topup=success` redirect just toasts + invalidates the balance query; the
   actual credit grant happens in `handleCreditCheckoutCompleted` off the Stripe
   `checkout.session.completed` (and `async_payment_succeeded`) webhook.
2. **The grant is idempotent, keyed on `stripe:cs:<sessionId>`.** `grantAddonCredits`
   REQUIRES an idempotency key; it inserts a `credit_ledger` row (reason
   `grant_addon`, unique `(tenant_id, idempotency_key, reason)` ON CONFLICT DO
   NOTHING) and only bumps `tenants.addon_credits` when that insert actually
   inserts. A duplicate/replayed webhook therefore credits exactly once and
   returns `{granted:false, newBalance:<current>}`.
3. **Amount verification is FAIL-CLOSED.** Fulfill only when
   `session.mode==='payment'`, `metadata.kind==='addon_credits'`,
   `payment_status==='paid'`, AND `typeof amount_total==='number' && amount_total
   === credits*OVERAGE_RATE_CENTS`. A missing/non-numeric `amount_total` must be
   REFUSED (never grant blind). Do not weaken this to a `typeof===number &&
   mismatch` check — that grants when the field is null.
4. **Only the idempotent credit path rethrows to force a Stripe retry.** The
   webhook business-logic `catch` in `stripeWebhookHandlers.ts` swallows-and-logs
   by default (so a retry can't double-apply a NON-idempotent subscription
   change), but rethrows when the event is credit fulfillment (`isCreditFulfillment`)
   so a transient DB failure after a real payment gets retried and never silently
   drops paid credits.

## Wiring notes
- Price is a **lookup_key get-or-create** (`addon_message_credit_v1`,
  `unit_amount = OVERAGE_RATE_CENTS = 3¢`), NOT inline `price_data` (the stripe
  skill forbids price_data). Checkout is `mode:payment`, card-only, quantity =
  credits.
- Route `POST /billing/credits-checkout` is `requireTenantAuth + requireTenantOwner`
  (owner-only, matching the client's `me.user.role === "owner"` gate), integer
  min 100 / max 1,000,000.
- Two client entry points route to the credits page `/onboarding/credits`: the
  Inbox "Buy Gas" button and the Campaigns "+ Top Up" button (both now just
  navigate — neither grants anything).

**Why:** grant-on-redirect or grant-without-amount-check hands out paid product
for free; a non-idempotent grant double-credits on Stripe's at-least-once
delivery. **How to apply:** any future auto-recharge / backup-topup purchase must
reuse `grantAddonCredits` with a stable idempotency key and the same fail-closed
amount check — never grant off a redirect or an unverified amount.
