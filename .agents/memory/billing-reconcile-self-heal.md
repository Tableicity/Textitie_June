---
name: Self-healing billing reconcile
description: Stored subscription status must be re-derivable from Stripe, not a one-shot webhook — how a paid-but-locked tenant heals itself.
---

# Self-healing billing reconcile

**Rule:** a tenant's unlocked/locked state must be **re-derivable from Stripe on read**, never left to a single write. Activation used to happen exactly once (the Stripe webhook); when that one event failed the paying tenant stayed locked forever with nothing that re-checked. The fix is a reconcile that verifies against Stripe from the paths a locked tenant naturally hits.

**Why:** the webhook business-logic switch swallows its errors and still returns 2xx (see [Stripe activation period-date crash](stripe-activation-period-date.md)), so Stripe records success and never retries. Any single-shot activation has this failure mode. A read-time reconcile removes the manual "re-trigger the webhook / flip billingBypass" recovery entirely — a fresh real payment now auto-unlocks.

**How to apply — the safety contract (all of these matter):**
- **Only heal from `active`/`trialing`.** Never let `past_due`/`canceled`/`incomplete` unlock. Prefer an `active` sub, then `trialing`.
- **Reuse the canonical idempotent activation** the webhook uses (`activateSubscription`) — don't fork a second activation path. It sets status, links the sub, resolves the billing period safely, ensures the usage record, syncs carrier add-ons.
- **Throttle + atomic claim.** Stamp a per-tenant `lastBillingSyncAt` with a **conditional UPDATE** (`WHERE null OR older-than-window ... RETURNING`) *before* the network call. This is a real lock: a concurrent burst of send/screen calls can't double-activate or double-write `billing_events`, and a slow/failing Stripe API can't be hammered. A failed Stripe call still consumes the window (acceptable — heals on the next window).
- **Never throw.** All failures log and return `{reconciled:false}` so a Stripe outage can never break a send or the billing screen.
- **Cost-gate the hot path.** Only tenants that are NOT already active/bypassed AND have a real `cus_` customer ever reach Stripe. On the send gate, an already-unlocked tenant triggers **zero** reconcile calls (guard on `isTextingUnlocked` first). A brand-new demo tenant has no customer → instant no-op.
- **Prove the tier before defaulting.** Resolve tierCode as: subscription `metadata.tierCode` (our checkout stamps it) → live price-id→tier map (`tiers.stripePriceId`) → tenant's stored plan → safe default. A blind default provisions the wrong included-credit allowance.
- **Where to hook:** the App billing read (so the paywall overlay clears on load) and the composer send gate. The status the billing endpoint returns is read fresh from the DB row, so healing the row is enough — no response-shape change, no new OpenAPI field/status value.

**Known gap (deferred by scope):** other send choke points (campaign/survey via `isTenantSendingExpired`) are NOT reconciled — only the composer gate + app read are. In practice the app-read heal fires before any UI-driven campaign, so the gap only matters for backend/scheduled sends by a still-locked tenant.

Key code: `artifacts/api-server/src/lib/billingReconcile.ts` (pure `shouldQueryStripeForReconcile` + `pickReconcileTarget` + orchestrator), hooked in `routes/billing.ts` (GET /billing/subscription) and `lib/demoTextingGate.ts`.
