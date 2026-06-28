---
name: Tenant seeding — two distinct systems
description: Where per-tenant signup defaults live vs boot-time demo re-seeding; which to edit when "expanding seeded data".
---

There are TWO unrelated seed paths. Pick the right one when asked to add/expand "seeded data".

1. **Per-tenant signup seeding** — `artifacts/api-server/src/routes/tenantAuth.ts`, inside the `db.transaction` that runs once per real registration. Seeds the new tenant's starter data (owner user, "Demo Department", welcome contact/conversation/message, and the default dispositions). Atomic with tenant creation, so a later failure rolls it all back.
   - **This is the one for "every new user/tenant at signup gets X by default."**

2. **Boot-time demo-tenant re-seeding** — `artifacts/api-server/src/lib/seedData.ts` (DEMO_TENANTS / DEMO_DEPARTMENTS / DEMO_CONVERSATIONS / DEMO_AUTOMATIONS / DEMO_SHORTCUTS). Re-created on EVERY server boot, only for the operator demo tenants. Editing this does NOT affect real signups.

**Why it matters:** the user keeps expanding signup defaults; putting them in seedData.ts would silently never reach real tenants, and putting demo-only data in tenantAuth.ts would hit real customers. They are not interchangeable.

**How to apply:** "new tenants should start with …" → tenantAuth.ts transaction. "the demo/sandbox tenants should show …" → seedData.ts. Existing tenants are NOT backfilled by either (prod data is read-only to the agent; backfill would go through the Conductor API).
