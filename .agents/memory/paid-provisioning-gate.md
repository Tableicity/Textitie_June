---
name: Paid-tier provisioning gate
description: Server-side paid gate for self-serve provisioning (departments, number purchase/assign) — every route claiming platform-billed resources must use the shared chokepoint.
---

**Rule:** Any tenant-auth route that self-serve provisions a platform-billed resource (create department, purchase number, ASSIGN a pool number) must call the shared `assertPaidTier` chokepoint (paid = subscription `active` || `billingBypass`, same rule as `isTextingUnlocked`). Client-side gating (`PaidTierGate.tsx` — stepper CTAs, nav buttons, page wrappers) is UX only; the server is the enforcement.

**Why:** During the 2026-07-02 paid-gate build, `POST /phone-numbers/assign` was the near-miss: it had only `requireTenantAuth` and its registry check only rejected numbers owned by *another* tenant — so unregistered platform-owned pool numbers passed, meaning a trial tenant could claim unlimited Twilio-billed numbers via curl even though the UI never offered it. "Not reachable from the UI" is not a gate.

**How to apply:**
- New provisioning route → call `assertPaidTier(tenantId, "<Feature>")` and return `{error, code}` at `gate.status` (402 `subscription_required` / 404 `tenant_not_found`). Don't inline tenant billing lookups.
- The signup pool auto-claim (demo number) deliberately bypasses this — it's the one free number, by design.
- Managing *existing* resources (rename/delete dept, member routes) stays ungated by design; only creation/claiming of new billed resources is paid.
- `past_due` is NOT paid (consistent with `isTextingUnlocked`).
- Client `useIsPaidTier` gates clicks only when *known* unpaid (query settled successfully) — fail-open on error to avoid a false paywall flash; server catches the rest.
