---
name: Stripe activation period-date crash
description: Why paying tenants silently stay locked — Stripe moved current_period_* off the Subscription object and it crashes Drizzle timestamp mapping.
---

# Stripe subscription activation: Invalid time value → paid tenant stays locked

**Symptom:** a customer pays (real active Stripe subscription + succeeded charge, webhook
delivered with `pending_webhooks:0`), but the tenant row stays `subscription_status='expired'`
with `stripe_subscription_id=NULL`, so the paywall never lifts. Affects **every** paying
customer, not one account.

**Root cause:** newer Stripe API versions (2025-03+ "Basil") **removed
`current_period_start` / `current_period_end` from the Subscription object** — the billing
period now lives on each subscription **item** (`items.data[i].current_period_*`). The
activation code read the (now-`null`) top-level fields and did `new Date(null|undefined * 1000)`
→ an **Invalid Date**, which throws `RangeError: Invalid time value` inside
`PgTimestamp.mapToDriverValue` when Drizzle serializes it for a Postgres `timestamp` column.
The throw aborts the whole `UPDATE tenants ...` activation.

**Why it's silent:** the webhook business-logic switch is wrapped in a try/catch that only
logs (`"Error handling Stripe webhook business logic"`) and the route still returns 2xx — so
Stripe records successful delivery (`pending_webhooks:0`) and never retries. Look for that log
line in deployment logs when "I paid but I'm still locked".

**Rule / how to apply:** never build a Date from a Stripe subscription's top-level
`current_period_*`. Resolve the period from `items.data[0]` first, fall back to the legacy
top-level fields, and **null out any non-finite value** so activation can never crash. The
tenants period columns are nullable, so writing `null` is safe. A pure resolver +
regression test guard this (`stripeSubscriptionPeriod.ts`).

**Reconcile a stuck-but-paid tenant (after the fix is published):** the customer already has
a live active subscription, so re-trigger activation through the (now-fixed) webhook — e.g.
touch the subscription (metadata) via the Stripe REST API from bash to emit a fresh
`customer.subscription.updated`, or resend the original event from the Stripe Dashboard. The
Conductor `PATCH /tenants/:id` only exposes `billingBypass` among billing fields (not
`subscriptionStatus`/`stripeSubscriptionId`), and the agent has read-only prod DB — so a
proper status flip must go through the webhook/activation path, not a raw write.
`billingBypass=true` is the only instant operator unlock but leaves status `expired`, which
keeps the Billing page showing a "Subscribe" button (re-subscribe / double-charge risk).
