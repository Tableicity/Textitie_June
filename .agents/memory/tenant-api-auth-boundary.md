---
name: Tenant vs Conductor API auth boundary
description: Why tenant-facing UI must call tenant-scoped endpoints and never reuse the Conductor admin /tenants/:id routes.
---

# Tenant vs Conductor API auth boundary

The whole `/api` router sits behind `conductorAuth`, which only lets a request through when
either the path matches a tenant **allow-listed prefix** (where a downstream `requireTenantAuth`
does the real check) or the caller presents a non-`tenant`-scope Conductor credential. A tenant
JWT (scope `tenant`) is **rejected on any non-allow-listed path**.

**The trap (durable):** Conductor admin routes like `/tenants/:id` have generated client hooks
that typecheck fine and even appear to work where conductor auth is left open, but a tenant-facing
page calling them **fails closed (401) in any correctly secured deployment** — silently, with no
real data. Do **not** "fix" that 401 by allow-listing `/tenants/:id`; that exposes an admin/IDOR
surface. Instead add or extend a tenant-scoped endpoint guarded by `requireTenantAuth` +
`tenantUser.tenantId` ownership.

**Guardrails when wiring tenant (non-Conductor) UI to account data:**
- Use tenant-scoped routes only; never the Conductor `/tenants` surface.
- Tenant org profile lives at the tenant-scoped settings endpoint (name/slug/region/phone/tier +
  compliance fields); mutating privileged fields (e.g. name) requires `admin`/`owner` and is
  audited, so role-gate the edit UI rather than shipping a button that 403s for agents.
- New tenant endpoints must be added to `openapi.yaml` and regenerated, not hand-wired.

**Why it matters:** failures are invisible at build time (types pass) and environment-dependent
(open dev vs. secured prod), so the wrong endpoint choice ships looking healthy and only breaks
for real tenant users.
