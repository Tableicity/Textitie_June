---
name: Phone pool auto-assign & release
description: How a trial tenant gets a number at signup and when numbers return to the Admin pool
---

# Phone pool auto-assign & release

**The "pool" = the Admin → Phone (Telephony) "Available Numbers" list = numbers the Twilio account OWNS minus those already in the canonical `phone_numbers` registry.** Compute it the SAME way `routes/telephony.ts` does (`incomingPhoneNumbers.list` minus the registry). It is NOT a separate persisted pool table and NOT a Twilio purchase/search flow — the user was explicit about this.

## Rule: signup auto-claims one number onto the Demo Department
`lib/phonePool.ts` `claimPoolNumberForDepartment` grabs the next available number and registers it (kind='department') to the new tenant's Demo Dept, wired post-commit in `routes/tenantAuth.ts`.
**Why gated on `getPublicWebhookConfig().available`:** a number is only useful if Twilio can deliver its inbound to us; skipping in dev/preview means throwaway signups never consume a real (billed) number and never hand out a "deaf" number.
**How to apply:** the claim is best-effort and MUST never throw — signup has to succeed even if the pool is empty / Twilio is down. It returns `{assigned:null, reason}` on every failure mode. Race-safe: `setDepartmentNumber` fails closed with `PhoneNumberConflictError` on a lost race, and the loop tries the next candidate.

## Rule: release trigger is ARCHIVE, not trial-expiry
`releaseAllTenantNumbers(tenantId)` (pure DB, one tx, in `phoneNumberRegistry.ts`) deletes all the tenant's canonical rows + clears the denorm columns; the numbers stay on the Twilio account = back in the pool. Called best-effort from the archive route.
**Why not on expiry:** `trialLifecycle` deliberately KEEPS the demo number on expiry ("your demo number and setup are saved") so a late converter isn't stranded. Archive is the definitive "tenant is done" signal; releasing there also unblocks the scheduled hard-purge (`phone_numbers` FK is RESTRICT).

## Gotcha: `normalizePhoneE164` throws on garbage
It returns null ONLY for empty input; for non-empty garbage it THROWS `PhoneNumberValidationError`. Any loop that normalizes Twilio-supplied numbers must wrap it in try/catch → skip, or one malformed number aborts the whole operation.
