---
name: Stripe Checkout wiring
description: How live Stripe products/prices are set up and what pitfalls to watch for when wiring Stripe Checkout in this project.
---

## Real Stripe products/prices (live account acct_1TEdhl0tnuZQWyqK)

Essentials (code `starter`): prod_UiyP2P9DyIHPAQ / price_1ToGC20tnuZQWyqKIRVFjx1m ($149/mo, 600 credits). Product renamed "Starter"→"Essentials" 2026-07. Old $139 price price_1TjWT10tnuZQWyqKTmJxYYou left ACTIVE (unused) — existing subs stay on it.  
Pro (code `growth`): prod_UiyQmjY2iRb6wQ / price_1TjWTB0tnuZQWyqKOoXRCb4A ($349/mo, 2000 credits)  
Phone Add-on: prod_UiyQ0SH9JqGmka / price_1TjWTC0tnuZQWyqKojNIwwLm ($14.95/mo)  
Enterprise: no Stripe price (custom — contact sales)

Source of truth is `seedData.ts` TIER_PRICING; `seedTiers()` runs on every api-server boot and RECONCILES the existing `tiers` row — name, description, features, monthlyPriceCents, includedCredits, hipaaEligible AND stripePriceId (the earlier "IDs survive because seed only touches desc/features" note is STALE). Prod gets tier DATA via seed-on-boot after publish (publish migrates schema, not data).

## Changing a live plan price (immutable-price runbook)

Stripe Price amounts are immutable — you CANNOT edit $139→$149. Checkout uses `tier.stripePriceId` (the exact DB id), not the product default_price. To change a price:
1. On the LIVE account: create a NEW price on the product, set it as default_price. (Product name/description ARE editable in place.)
2. Swap `stripePriceId` in `seedData.ts` to the new id.
3. Restart api-server → seedTiers reconciles the DEV row. Re-publish → prod boot reconciles the PROD row.
4. Leave the OLD price ACTIVE until prod is republished, or prod checkout (still pointing at the old id) breaks. Archive it only AFTER prod is verified on the new id; archiving does NOT migrate existing subscriptions.

**LIVE key access gotcha:** the live `STRIPE_SECRET_KEY` (sk_live) is in the SHELL env but NOT in the code_execution sandbox. `listConnections('stripe')` in the sandbox returns a DEV/SANDBOX Stripe account (`environment: development`; key field is `secret`, not `secret_key`) — wrong account for live changes. Do live Stripe ops via a one-off `tsx` script from bash (`pnpm --filter @workspace/api-server exec tsx <script>`), which inherits the live key.

## Key pitfalls

**Stub customer ID guard:** Demo-seeded tenants have `stripe_customer_id = 'cus_stub_demo_acme'`. The checkout function treats any ID that doesn't start with `cus_` (excluding `cus_stub`) as missing and creates a real Stripe customer. Without this guard, Stripe returns "No such customer".

**Stripe v22 Subscription type:** `current_period_start`/`current_period_end` are not top-level on the Stripe v22 `Subscription` TypeScript type. Cast `rawSub as unknown as { id, status, trial_end, current_period_start, current_period_end }` before passing to `activateSubscription`.

**Tenant JWT scope:** `requireTenantAuth` requires `scope: "tenant"` in the JWT payload. Superuser tokens (from `/auth/login`) will hit "Invalid or expired token". Tenant agents log in via `/api/tenant-auth/login`. All demo accounts have MFA enabled, so dev testing requires minting a token manually.

**Generated API client call convention:** `createCheckoutSession(body)` takes the body directly (not `{ data: body }`). The `{ data: ... }` wrapper is only for the mutation hook options type.

**Why:** The prices had to be created fresh because the original price IDs in the project brief belonged to a different Stripe account/mode than `STRIPE_SECRET_KEY` (which is `sk_live_51…` on acct_1TEdhl0tnuZQWyqK).
