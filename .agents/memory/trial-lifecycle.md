---
name: Free-trial lifecycle (soft expiry + daily budget)
description: How trial expiry/reminders and the trialing daily outbound cap work, plus the OpenAPI subscription-status gotcha.
---

# Free-trial lifecycle

Trial soft-expiry + reminders run on the shared 60s timer engine (one more
`try/catch` step in `runTimerCycle`), NOT a dedicated scheduler. Per trialing
tenant with a `trialEndsAt`: day-7/day-2/expired internal notifications fire
once each (idempotent via a UNIQUE `(tenant_id, type)` + ON CONFLICT DO NOTHING),
and at/after expiry the status flips `trialing` → `expired`. Demo number stays
assigned; the user-app swaps the main view for an "Upgrade to keep going" wall
(except `/billing`, which must stay reachable so they can pay).

## Subscription-status enum gotcha (durable)
`getSubscriptionDetails` returns the tenant's `subscriptionStatus` **raw**
(`status: t.subscriptionStatus`), and `GET /billing/subscription` ships it
straight through. The frontend type comes from the OpenAPI `SubscriptionDetail.status`
**enum**. So any NEW subscription status (this added `expired`) MUST be added to
that enum in `lib/api-spec/openapi.yaml` and the client regenerated, or the
generated TS union won't include it and the UI literally can't branch on it.
**Why:** the raw passthrough means the DB can emit values the contract doesn't
know about; the enum is the only place the frontend learns them.

## Trial daily outbound budget — intentionally best-effort (durable)
Trialing tenants are capped at 15 outbound **segments** per rolling 24h
(`TRIAL_DAILY_SEGMENT_CAP`), enforced in `demoTextingGate.evaluateDemoTextingGate`
by summing `credit_ledger.credits` (direction='outbound', last 24h) and adding
the pending message's `calculateMessageCredits().credits`. Over → HTTP 402 with
the exact `DAILY_TRIAL_LIMIT_MESSAGE`. This is a **read-before-send** check, so
it is NOT race-safe under concurrent sends (two parallel sends can both pass and
slightly overshoot). That is an accepted limitation for a trial *soft* cap — it
mirrors how the existing credit path behaves and avoids a distributed lock for a
sandbox limit. Do not "fix" it with locking unless the cap becomes billing-critical.
**Why:** the ledger row is written AFTER the carrier send, so a pre-send SUM can
only ever see prior confirmed sends.

## Expiry flip safety
The flip is doubly guarded — `status='trialing'` AND `trialEndsAt <= now` — so a
concurrent upgrade to active OR a concurrent trial *extension* (status stays
trialing, trialEndsAt pushed out) is never clobbered by a stale processor. The
flip + the "expired" notification insert run in ONE transaction so the
notification can't be skipped after a successful flip (insert throws → flip rolls
back → next cycle retries both). Best-effort side effects (billing_events audit +
email-stub log) run after commit and never roll back the flip.
