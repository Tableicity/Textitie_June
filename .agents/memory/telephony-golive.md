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

3. **Routing is ONE deterministic lookup against the canonical `phone_numbers` table.**
   `lib/tenantPhoneLookup.ts` normalizes `To` to E.164 and does a single PK lookup on
   `phone_numbers` (phone_number → tenant_id). BOTH a tenant's primary number and a department
   number route to their true owner; an unknown number FAILS CLOSED (returns null) and is NEVER
   resolved to "the first tenant". This replaced the original two-source resolver (exact
   `tenants.phone_number` match + an unscoped `departments` fallback returning the first tenant
   iterated) that caused the verified +18887619212 cross-tenant leak.
   **Write rule:** never write `tenants.phone_number` / `departments.phone_number` directly — go
   through `artifacts/api-server/src/lib/phoneNumberRegistry.ts`, the only writer; it rejects
   cross-tenant conflicts and keeps the canonical table + denorm columns in lockstep. See
   `phone-number-canonical-routing.md` and John/architecture.doc.md Part 5.

Signup (`POST /tenant-auth/register`) creates tenant + owner user in one txn (no number). The
owner's required 10-digit phone is A2P opt-in evidence, distinct from the tenant's sending number.
