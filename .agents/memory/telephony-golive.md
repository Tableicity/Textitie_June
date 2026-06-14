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

2. **Inbound webhook IS now auto-wired by code (best-effort).** Purchase, tenant department-assign,
   AND admin primary-assign all point the number's "A message comes in" webhook at
   `https://<published-domain>/api/webhooks/twilio` (POST) plus a delivery `statusCallback`, through the
   single helper `lib/twilioNumberWebhook.ts` (`buildInboundWebhookParams` is the one payload
   definition; URLs come from `lib/publicTwilioUrls.ts`). It is best-effort: the canonical
   `phone_numbers` registry is the source of truth, so a webhook/Twilio failure is logged (warn) and
   NEVER fails the assign/create. It is SKIPPED when no public https URL exists (dev/preview with only
   a `.replit.dev` host and no `PUBLIC_WEBHOOK_BASE_URL`) — purchase refuses outright there, but
   admin primary-assign still records the number and leaves it deaf until a public URL exists + repair
   runs. Backstops: `GET /phone-provisioning/reconcile` reports webhook mismatches and
   `POST /phone-provisioning/repair-webhooks` re-points every registered number (now also restores
   `statusCallback`, via the same helper). Manual Twilio-console setup is now only a fallback.
   **Why:** the old "no code sets smsUrl → number silently deaf after assign" trap is closed for the
   common paths; the remaining trap is a preview / no-public-URL environment, not the code path.

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
