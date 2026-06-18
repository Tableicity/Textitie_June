---
name: Stripe Checkout wiring
description: How live Stripe products/prices are set up and what pitfalls to watch for when wiring Stripe Checkout in this project.
---

## Real Stripe products/prices (live account acct_1TEdhl0tnuZQWyqK)

Starter: prod_UiyP2P9DyIHPAQ / price_1TjWT10tnuZQWyqKTmJxYYou ($139/mo)  
Teams (growth): prod_UiyQmjY2iRb6wQ / price_1TjWTB0tnuZQWyqKOoXRCb4A ($349/mo)  
Phone Add-on: prod_UiyQ0SH9JqGmka / price_1TjWTC0tnuZQWyqKojNIwwLm ($14.95/mo)  
Enterprise: no Stripe price (custom — contact sales)

These IDs live in the `tiers.stripe_price_id` DB column. The seed update path only touches `description`/`features`/`hipaaEligible`, so the IDs survive re-seeds.

## Key pitfalls

**Stub customer ID guard:** Demo-seeded tenants have `stripe_customer_id = 'cus_stub_demo_acme'`. The checkout function treats any ID that doesn't start with `cus_` (excluding `cus_stub`) as missing and creates a real Stripe customer. Without this guard, Stripe returns "No such customer".

**Stripe v22 Subscription type:** `current_period_start`/`current_period_end` are not top-level on the Stripe v22 `Subscription` TypeScript type. Cast `rawSub as unknown as { id, status, trial_end, current_period_start, current_period_end }` before passing to `activateSubscription`.

**Tenant JWT scope:** `requireTenantAuth` requires `scope: "tenant"` in the JWT payload. Superuser tokens (from `/auth/login`) will hit "Invalid or expired token". Tenant agents log in via `/api/tenant-auth/login`. All demo accounts have MFA enabled, so dev testing requires minting a token manually.

**Generated API client call convention:** `createCheckoutSession(body)` takes the body directly (not `{ data: body }`). The `{ data: ... }` wrapper is only for the mutation hook options type.

**Why:** The prices had to be created fresh because the original price IDs in the project brief belonged to a different Stripe account/mode than `STRIPE_SECRET_KEY` (which is `sk_live_51…` on acct_1TEdhl0tnuZQWyqK).
