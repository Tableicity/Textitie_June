# Stage 4 — Schema-Per-Tenant Migration Plan

> Goal: move from row-level `tenant_id` filtering to PostgreSQL **schema-per-tenant** isolation per the multi-tenancy guide. Each tenant gets its own schema (`tenant_acme`, `tenant_orbital`, etc.); the same Drizzle table definitions are reused, with `search_path` set per connection.
>
> **Estimated effort:** 2–3 working sessions. Highest blast-radius change in this whole project — touches 17 server files and migrates live ACME data.

---

## Current snapshot (taken before migration)

### Tenants
| id | slug | name |
|---|---|---|
| 1 | acme | ACME Corp |
| 2 | orbital | Orbital Logistics |
| 3 | helvetia | Helvetia Privatbank |
| 4 | orbital-test | Orbital Test GmbH |

### Live data volume
- `conversations`: 7 rows
- `messages`: linked via conversation_id (no direct tenant_id)
- `contacts`: 2 rows
- `conversation_events`: 7 rows
- `tenant_users`: 2 rows

**Translation:** real production data is tiny. ACME is the only tenant being actively used. Migration risk is mostly *code*, not *data loss*.

### Server-side `db.X` call sites to refactor (17 files)
| File | Calls |
|---|---|
| `lib/automationEngine.ts` | 8 |
| `lib/seedData.ts` | 6 |
| `routes/conversations.ts` | 5 |
| `lib/timerEngine.ts` | 4 |
| `lib/stripe-stub.ts` | 3 |
| `routes/tenantAuth.ts` | 2 |
| `routes/campaigns.ts` | 2 |
| `routes/webhooks.ts` | 1 |
| `routes/tiers.ts` | 1 |
| `routes/tenants.ts` | 1 |
| `routes/tenantSettings.ts` | 1 |
| `routes/surveysPublic.ts` | 1 |
| `routes/departments.ts` | 1 |
| `routes/agents.ts` | 1 |
| `lib/integrations/syncWorker.ts` | 1 |
| `lib/audit.ts` | 1 |

---

## What stays public vs what moves

### Stays in `public` schema (platform-wide)
- `tenants` — the registry itself
- `tenant_users` — who can log into which tenant (cross-schema FK to tenants.id)
- `email_verifications` — MFA codes (FK to tenant_users)
- `tiers` — global pricing catalog
- `users` — legacy table, leave dormant or drop in Stage 5
- `webhook_events` — global webhook log (or per-tenant — TBD; today no tenant_id)
- `injections` — has tenant_id but it's a global staging table; **decision needed**
- `session` — auto-created by connect-pg-simple if/when we adopt it (Stage 5)

### Moves into per-tenant schemas (`tenant_<slug>`)
**Tables with `tenant_id` today (20):** audit_logs, automation_rules, billing_events, campaigns, contacts, conversations, crm_sync_queue, departments, dispositions, integrations, message_templates, opt_ins, opt_outs, reminders, survey_responses, survey_sends, surveys, usage_records.
*(also: tenant_users and injections, but those stay in public per above)*

**Child tables (no `tenant_id`, inherit isolation via parent FK):**
- `messages` → linked to `conversations.id`
- `campaign_messages` → linked to `campaigns.id`
- `department_members` → linked to `departments.id` and `tenant_users.id`

**Total per-tenant tables: 21** (18 with tenant_id we keep + 3 child tables).

When the migration runs, the `tenant_id` column on the moved tables becomes redundant. **Plan:** keep it during migration as belt-and-suspenders; drop in a follow-up after one week of clean operation.

---

## Architectural decisions to lock before touching code

1. **Where does the slug live in the session?** Today the token has `tenantId` but not `tenantSlug`. To set `search_path`, we need the slug on every request. **Decision:** add `tenantSlug` to the JWT payload at login/verify-mfa time so middleware can read it without an extra DB hop.

2. **One pool per tenant, or one pool with `SET LOCAL search_path` per query?** The guide caches one pool per slug (`tenantPools` Map). Cleaner, but unbounded if tenant count grows. **Decision:** start with per-tenant pool cached in a Map; revisit when we have 100+ tenants.

3. **Drizzle table defs — single set or per-schema?** The guide reuses one set of Drizzle table definitions across all tenant schemas (the schema isolation comes from `search_path`, not from the definitions). **Decision:** reuse one set, but **drop the `tenantId` column from the moved tables' Drizzle defs** since it's redundant inside a tenant schema.

4. **How to provision a new tenant's schema?** Two options:
   - **a)** Drizzle migrations — but drizzle-kit doesn't natively manage per-tenant schemas.
   - **b)** Raw SQL DDL in a `provisionTenantSchema(slug)` function (what the guide does).

   **Decision:** option (b). Generate the DDL once from current Drizzle defs, store in `lib/db/src/tenant-ddl.sql`, run it whenever a tenant is created. When schema changes, write a backfill function that loops over all tenants and applies the change.

5. **Twilio inbound routing.** Currently looks up `tenants.phone_number = To` in public, then queries `conversations` filtered by `tenant_id`. Post-migration: still look up tenant in public, then **switch the connection to that tenant's schema** before touching conversations. **No public-API change.**

6. **What if a route has no tenant context?** Today: `requireTenantAuth` middleware enforces it. Post-migration: same, plus we attach `req.tenantDb` (pre-scoped to the right schema). Routes that legitimately span tenants (admin / super-user) use the platform `db` directly.

---

## Migration in 5 phases (each = own session, each shippable)

### Phase 4A — Plumbing (no data movement)
**Scope:**
- Add `getTenantDb(slug)` factory in `lib/db/src/tenant-db.ts` that returns a Drizzle instance with `search_path` set to `tenant_<slug>, public`.
- Add `provisionTenantSchema(slug)` that runs the full per-tenant DDL.
- Add `req.tenantDb` to the Express request type and populate it in `requireTenantAuth` middleware (after we add slug to the token).
- Add `tenantSlug` to login + verify-mfa + register payloads. **Existing sessions stay valid** because old tokens without slug still work (route does a lookup fallback).
- **No data migration yet. No route refactors yet.** All routes still use the platform `db`.

**Acceptance:** existing app behavior unchanged. New plumbing exists but isn't called.

**Risk:** very low. Pure addition.

### Phase 4B — Provision per-tenant schemas, double-write
**Scope:**
- Run `provisionTenantSchema()` for all 4 existing tenants (acme, orbital, helvetia, orbital-test) → empty schemas materialize.
- **Refactor the 17 files** to read/write through `req.tenantDb` for the 21 moved tables.
- **For one full session, double-write:** every insert/update/delete also writes to the old `public.<table>` for the same tenant, so we can compare and roll back.
- Read path still uses public.

**Acceptance:** every write shows up in both `public.<table>` (with tenant_id) and `tenant_<slug>.<table>` (without). Verified via SQL diff.

**Risk:** medium. Refactor surface is large (17 files). Mitigation: keep double-write so reads never lose data. We can roll back by switching the read path back to public.

### Phase 4C — Backfill and switch reads
**Scope:**
- Backfill script: for each tenant, copy existing rows from `public.<table>` (filtered by tenant_id) into `tenant_<slug>.<table>`.
- Verify row counts match per tenant per table.
- Switch read path to `req.tenantDb`.
- Keep double-write on for a beat (one day live) so we have a rollback exit.

**Acceptance:** app behaves identically. Reads come from per-tenant schemas. ACME data unchanged.

**Risk:** medium. The backfill itself is idempotent (`INSERT ... ON CONFLICT DO NOTHING`). The cutover moment is the risk. Mitigation: do it during quiet hours, watch logs.

### Phase 4D — Stop double-writing, drop tenant_id columns
**Scope:**
- Remove the public-side write code paths.
- Drop `tenant_id` columns from the 18 moved tables in `public` (or just truncate those tables and leave the columns as a graveyard until we're sure).
- Truncate `public.<table>` for the 18 moved tables.
- **Do not drop public tables yet** — keep them empty as an emergency cache for one week.

**Acceptance:** writes go only to per-tenant schemas. Tenant isolation now structurally enforced by Postgres, not by app filters.

**Risk:** low (after 4C succeeds).

### Phase 4E — Cleanup
**Scope:**
- Drop the now-empty `public.<table>` for the 18 moved tables.
- Remove the `tenantId` column from the moved tables' Drizzle defs.
- Add a tenant-isolation playwright test: sign up tenant A and tenant B, send a message from each, assert each only sees their own (this also covers Stage 1 acceptance).

**Acceptance:** schema-per-tenant is canon. Cross-tenant queries are structurally impossible without explicit `SET search_path`.

**Risk:** low.

---

## Things that can go wrong + mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| Backfill misses rows | Low | Row-count verification per tenant per table; idempotent script |
| New code path crashes for some tenant | Medium | Phase 4B double-writes for a session before we cut reads; logs flag any tenant that doesn't get a parallel write |
| Twilio webhook routes to wrong tenant during cutover | Low | Webhook lookup is unchanged (always `public.tenants` → slug → switch DB) |
| `search_path` leaks across requests in pool | Low | Set on `pool.on("connect", ...)` as the guide shows — fires per new connection, not per query |
| Connection pool exhaustion (one pool per tenant) | Low while N<100 | Cache map; revisit when scaling |
| Drizzle migrations conflict with manual DDL | Medium | Stop using `drizzle-kit push` for per-tenant tables; use the provisioner function as the source of truth |
| Trial signups created during migration end up with no schema | Low | Phase 4B onward: `register` endpoint calls `provisionTenantSchema()` after the tenants insert |

---

## What I need from you before Phase 4A starts

1. **Approval to begin** — Phase 4A is low risk but it changes the auth token shape. Confirm.
2. **Backup expectation** — Replit auto-checkpoints the codebase, but does NOT snapshot the Postgres database between checkpoints. **Recommendation:** before Phase 4C cutover, I'll dump the public-schema data to `John/pre-stage4-backup.sql` so we have a recoverable snapshot of every row in every shared table.
3. **Timing** — Phases 4A–C should be done in one continuous session if possible (or at least 4B+4C together) so double-write never sits exposed for more than a day. 4D and 4E can be a follow-up session after we've watched it run for 24 hours.
4. **Tenant cleanup question** — three of the four existing tenants (orbital, helvetia, orbital-test) have **no real data**. Do you want them migrated, or do you want me to delete them first so we only carry ACME forward?

---

## File-by-file change list

### New files
- `lib/db/src/tenant-db.ts` — `getTenantDb(slug)` + per-slug pool cache
- `lib/db/src/tenant-provisioner.ts` — `provisionTenantSchema(slug)` with full DDL
- `scripts/src/backfill-tenant-schemas.ts` — copy public → per-tenant
- `scripts/src/verify-tenant-isolation.ts` — row count parity check

### Modified files (auth)
- `artifacts/api-server/src/middleware/tenantAuth.ts` — populate `req.tenantDb`
- `artifacts/api-server/src/routes/tenantAuth.ts` — add `tenantSlug` to token + call provisioner on register
- `artifacts/api-server/src/routes/auth.ts` — same token shape change

### Modified files (routes — 14 files using db.X for moved tables)
- `routes/conversations.ts`, `routes/campaigns.ts`, `routes/departments.ts`, `routes/agents.ts`, `routes/surveysPublic.ts`, `routes/tenantSettings.ts`, `routes/webhooks.ts`
- `lib/automationEngine.ts`, `lib/timerEngine.ts`, `lib/stripe-stub.ts`, `lib/seedData.ts`, `lib/audit.ts`, `lib/integrations/syncWorker.ts`

### Untouched (already platform-only)
- `routes/tiers.ts`, `routes/tenants.ts`, `routes/health.ts`, `routes/billing.ts` (mostly)
- `lib/sama.ts` (Twilio adapter — talks to external API, no DB)

---

## Honest assessment

This is a *correct* but *expensive* refactor. After Stage 4 we will have:
- Structural tenant isolation (cross-tenant queries impossible without explicit schema switch)
- Match with your other Replit SaaS projects (per "build once" requirement)
- A clean upgrade path to per-tenant backups, per-tenant SQL exports, per-tenant compliance audits

What we **lose:**
- Easy ad-hoc cross-tenant analytics queries (now require a UNION ALL across schemas, or a separate analytics warehouse)
- One-shot drizzle-kit push for schema changes — every change now needs a backfill loop
- Some operational simplicity (one DB → one schema → many tables)

**My read:** worth it given Option B is locked and your other projects already use this pattern. But this is the last reversible point. If you want to flip back to row-level + Postgres RLS (Option A), say so before Phase 4A.
