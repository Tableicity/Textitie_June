---
name: Billing plan-card purchase gating
description: How the tenant Billing page decides "Current Plan" (disabled) vs re-purchasable vs trial CTA, keyed on subscription STATUS not just tier.
---

# Billing plan-card CTA / purchase gating

The tenant Billing page (`artifacts/user-app/src/pages/Billing.tsx`) renders one card per plan tier with a CTA/disabled state. The gate must key on the subscription **status**, not just the tier code.

**Why:** an expired/lapsed tenant KEEPS its old `planTierCode` (the tier it trialed). Gating "Current Plan" purely on `currentTier === plan.tierCode` wrongly disables that tier for a lapsed tenant, so they cannot re-purchase — the exact bug reported for an expired-trial owner.

**How to apply — the status buckets:**
- `active` | `trialing` → a genuinely current plan: keep it disabled with "Current Plan"; other tiers = upgrade/downgrade.
- `expired` | `canceled` → **lapsed, re-purchasable**. Show a purchase CTA ("Subscribe"), and **hide all "free trial" copy** — the server (`stripeCheckout.ts`, `canTrial = !trialUsed`) grants NO new trial once one is used, so a lapsed tenant is charged immediately. `canceled` is safe to re-buy because `handleSubscriptionDeleted` clears `stripeSubscriptionId`.
- `past_due` → **do NOT treat as re-purchasable.** It still has a LIVE Stripe subscription (payment retrying). Keep its current tier disabled/"Current Plan". A fresh checkout would spawn a duplicate subscription — `POST /billing/checkout` / `createCheckoutSession` has **no server-side guard** against an existing live sub. (Known gap: past_due lacks a proper "resolve payment"/billing-portal recovery flow, and non-current tiers still fall through to a checkout CTA — deferred, out of scope.)
- `none` → never subscribed → trial-eligible → "Start Free Trial".

So: `isCurrent = (isSubscribed || isPastDue) && currentTier === plan.tierCode`, where `isSubscribed = active|trialing`; `isLapsed = expired|canceled` drives the "Subscribe" CTA + trial-copy suppression.

Note: this plan-card gating lives in TWO surfaces that are kept in sync — `pages/Billing.tsx` and the onboarding `pages/onboarding/Plans.tsx`. Any change to the gating semantics (isSubscribed / isPastDue / isLapsed / isCurrent / CTA labels) must be applied to BOTH or they drift.
