---
name: Tenant vs Conductor API auth boundary
description: Why tenant-facing UI must call tenant-scoped endpoints and never reuse the Conductor admin /tenants/:id routes.
---

# Tenant vs Conductor API auth boundary

The whole `/api` router is mounted behind `conductorAuth` (api-server `app.ts`). `conductorAuth`
lets a request through in three cases: (1) the path matches an **allow-listed prefix**
(e.g. `/tenant-auth/`, `/tenant-settings/`, `/billing`, `/conversations`, `/departments`,
`/agents`, `/campaigns`, `/contacts`, …) where a downstream `requireTenantAuth` does the real
tenant check; (2) a Conductor Bearer token whose scope is **not** `"tenant"`; (3) Basic auth /
open mode. A **tenant JWT (scope `"tenant"`) is rejected on any non-allow-listed path.**

**The trap:** generated hooks exist for the Conductor admin routes `GET/PATCH /tenants/:id`
(`useGetTenant` / `useUpdateTenant`). They typecheck fine and even "work" against a misconfigured
dev/prod where conductor auth is open, but a tenant-facing page using them **401s in any correctly
secured deployment** because `/tenants/:id` is Conductor-only. The failure is silent at build time.

**Rule:** tenant-facing UI (the `/onboarding/*` account-settings island, inbox, etc.) must call
**tenant-scoped** endpoints guarded by `requireTenantAuth` + `tenantUser.tenantId` ownership —
never the Conductor `/tenants/:id` admin surface. Do **not** "fix" a 401 by adding `/tenants/:id`
to the conductorAuth allow-list; that opens an IDOR/admin surface.

**Org profile for tenants** = `GET/PATCH /api/tenant-settings/me` (returns name, slug, region,
phoneNumber, tierCode + compliance fields). `PATCH` of `name` (and compliance fields) requires
role `admin`/`owner` (agents get 403), and is audit-logged. Gate the edit UI by `useTenantMe`
role so non-admins see read-only instead of a button that 403s.

**Why:** during the onboarding build, `Organization.tsx` first used `useGetTenant`/`useUpdateTenant`
(`/tenants/:id`) and silently failed closed (401) — it showed no real account data. Fix was to
extend the existing tenant-scoped `/tenant-settings/me` and repoint the page.

**How to apply:** when wiring any tenant (non-Conductor) page to account/org data, check
`conductorAuth`'s allow-list first; if the route you want isn't tenant-scoped, add/extend a
`requireTenantAuth` endpoint (and expose it in `openapi.yaml` + regenerate) rather than reaching
for the admin `/tenants` hooks.
