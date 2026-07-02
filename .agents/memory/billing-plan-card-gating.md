---
name: Billing plan-card purchase gating
description: How the tenant Billing page decides "Current Plan" (disabled) vs re-purchasable vs trial CTA, keyed on subscription STATUS not just tier.
---

# Billing plan-card CTA / purchase gating

The tenant Billing page (`artifacts/user-app/src/pages/Billing.tsx`) renders one card per plan tier with a CTA/disabled state. The gate must key on the subscription **status**, not just the tier code.

**Why:** an expired/lapsed tenant KEEPS its old `planTierCode` (the tier it trialed). Gating "Current Plan" purely on `currentTier === plan.tierCode` wrongly disables that tier for a lapsed tenant, so they cannot re-purchase — the exact bug reported for an expired-trial owner.

**How to apply — the status buckets (updated 2026-07-02):**
- `active` → a genuinely current plan: keep it disabled with "Current Plan"; other tiers = upgrade/downgrade. Only status with a Cancel Plan button.
- `trialing` → **NOT subscribed.** The free trial is app-level (stamped at signup, `trialUsed=true`) with NO live Stripe subscription, so EVERY plan card stays clickable "Subscribe" (no "Current Plan" badge even though `planTierCode` is set to starter/Essentials), hide "free trial" copy (checkout charges immediately — no second trial), hide Cancel (nothing to cancel). Checkout is safe: the dup-subscription risk only applies to a live Stripe sub.
- `expired` | `canceled` → **lapsed, re-purchasable**. Show a purchase CTA ("Subscribe"), and **hide all "free trial" copy** — the server (`stripeCheckout.ts`, `canTrial = !trialUsed`) grants NO new trial once one is used, so a lapsed tenant is charged immediately. `canceled` is safe to re-buy because `handleSubscriptionDeleted` clears `stripeSubscriptionId`.
- `past_due` → **do NOT treat as re-purchasable.** It still has a LIVE Stripe subscription (payment retrying). Keep its current tier disabled/"Current Plan". A fresh checkout would spawn a duplicate subscription — `POST /billing/checkout` / `createCheckoutSession` has **no server-side guard** against an existing live sub. (Known gap: past_due lacks a proper "resolve payment"/billing-portal recovery flow, and non-current tiers still fall through to a checkout CTA — deferred, out of scope.)
- `none` → never subscribed → trial-eligible → "Start Free Trial".

So: `isCurrent = (isSubscribed || isPastDue) && currentTier === plan.tierCode`, where `isSubscribed = active` ONLY; `isLapsed = expired|canceled` and `isTrialing` both drive the "Subscribe" CTA + trial-copy suppression. Gotcha: the unused legacy `/billing/subscribe` route 409s on trialing — the UI's checkout path is `/billing/checkout`, which has no status guard.

Note: this plan-card gating lives in TWO surfaces that are kept in sync — `pages/Billing.tsx` and the onboarding `pages/onboarding/Plans.tsx`. Any change to the gating semantics (isSubscribed / isPastDue / isLapsed / isCurrent / CTA labels) must be applied to BOTH or they drift.
