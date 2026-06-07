---
name: Two user/login systems
description: SAMA/Textitie has two separate login tables — superusers vs per-tenant agents — that are easy to confuse.
---

# Two separate login systems

There are **two distinct user tables**, and confusing them causes wrong answers about "who can log in".

- `users` table — **superusers** who sign into the admin Conductor UI at `/admin/`. Role `superuser` is the platform admin.
- `tenant_users` table — **per-tenant** logins (owner + agents) who sign into the **agent inbox** in the user-app. Columns include `tenantId` (FK), `email` (unique), `passwordHash`, `name`, `role` (owner/admin/agent), `status`, `phone`. Scope tenant queries by `tenantId`.

**Why:** The same human can exist in both tables with different emails, and an email seeded as an ACME `tenant_users` admin is NOT the same identity as the `/admin/` superuser. When asked "which login belongs to tenant X", read `tenant_users WHERE tenant_id = X` — not `users`.

**How to apply:**
- Admin-facing "who logs into this tenant" features read `tenant_users` and must be conductor-scoped (mounted under `/api` which has global `conductorAuth`). The per-tenant `/agents` endpoint uses `requireTenantAuth` (per-tenant JWT) and is NOT usable for cross-tenant admin views.
- **Never** return `passwordHash` (or any seed password) in a response — use an explicit column projection, not `select()`.
