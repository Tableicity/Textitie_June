---
name: Telephony go-live gotchas
description: What actually has to be true for a tenant's number to send/receive — beyond assigning it in admin.
---

# Bringing/assigning a number — the real go-live gates

Assigning a number to a tenant (admin Telephony dropdown → `PATCH /tenants/:id {phoneNumber}`,
or self-service purchase) only writes the number to the database. Three external/structural
conditions must also hold, none enforced end-to-end by the app:

1. **Same Twilio account.** The platform uses ONE Twilio client (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`).
   The admin dropdown lists only `incomingPhoneNumbers.list()` from that account, and outbound is
   double-gated (DB ownership in `outboundFrom.ts` + Twilio account ownership → error 21660 if not).
   A "brought" number must live in the platform's account, not the operator's separate account.

2. **Inbound webhook is NOT set by any code.** Grep for `smsUrl`/`messagingServiceSid` = nothing.
   Neither assign nor purchase configures the number's "A message comes in" webhook. For inbound to
   route, the number's Twilio webhook (or its Messaging Service) must be pointed MANUALLY at
   `https://<published-domain>/api/webhooks/twilio` (POST). Must be the published domain, not
   `.replit.dev` preview. Route is public (conductorAuth exempts `/webhooks/`), protected by Twilio
   signature instead.
   **Why:** this absence-of-code is the #1 "number won't receive texts" trap and is invisible from the admin UI, which says "inbound texts now route to X" on save.

3. **Assign as the tenant PRIMARY number, not a department.** Inbound resolver
   (`lib/tenantPhoneLookup.ts`) step 1 = exact `tenants.phone_number == To` (E.164, correct).
   Step 2 (department fallback) is BROKEN since Stage 4 was rolled back: `getTenantPool(slug)` now
   returns the global pool, so `SELECT 1 FROM departments WHERE phone_number=$1` is unscoped and
   returns the FIRST tenant iterated whenever any department holds that number — wrong-tenant
   attribution. Avoid the purchase→department path for go-live until the resolver re-adds a
   `tenant_id` filter.

Signup (`POST /tenant-auth/register`) creates tenant + owner user in one txn (no number). The
owner's required 10-digit phone is A2P opt-in evidence, distinct from the tenant's sending number.
