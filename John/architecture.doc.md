# Architecture Lessons — From the SAMA / Textitie Build

A practical retrospective and forward-looking checklist for the next SaaS build, written after shipping the Stage 4 schema-per-tenant migration on SAMA Messaging.

---

## Part 1 — What Made Stage 4 Hard

The hardest part wasn't the schema migration itself. It was that decisions made (or not made) in the first phase of the project compounded into a multi-session refactor by the time we needed to isolate tenants properly.

### Hurdle 1 — Tenant isolation was bolted on, not designed in

By the time we got to Stage 4, ~13 separate libraries (campaigns, billing, surveys, routing, compliance, sync workers, timer engine, automation engine, credit engine, stripe stub, delivery status, attribution, audit) had each been written assuming a single shared `db`/`pool` import. None of them carried tenant context, because they didn't have to — the app was effectively single-tenant under the hood.

The Stage 4 refactor required:
- Threading a `tenantSlug` parameter through every one of those libraries
- Updating every caller (≈20 route call-sites)
- Introducing an `AsyncLocalStorage` shim so route handlers wouldn't need to be rewritten
- Verifying nothing silently regressed

That cascade is what made the work expensive.

### Hurdle 2 — Two execution contexts, two patterns

Routes have a "current tenant." Background workers, fire-and-forget promises, boot-time seeders, and webhook handlers do not. We ended up with two parallel patterns that both have to be applied correctly:
- **Request-scoped code:** `AsyncLocalStorage` + Proxy `db`/`pool`
- **Non-request code:** explicit `tenantSlug` argument + `getTenantDb(slug)` / `getTenantPool(slug)`

If you forget to apply the right one, the app keeps "working" — it just writes to the wrong schema. That's the most dangerous failure mode in the whole system.

### Hurdle 3 — Boot-time seeding ran without tenant context

`seedData.ts` ran at server startup, before any request, with no ALS context. Every per-tenant write it made would have silently landed in `public` instead of `tenant_acme`. Required a full rewrite to use `getTenantDb('acme')` explicitly.

### Hurdle 4 — Two parallel data shapes during the cutover

Both `public.contacts` and `tenant_acme.contacts` existed simultaneously with the same data for the duration of the migration. Doubles the cognitive load on every read and every fix. We're only safe now because we explicitly truncated `public` at the end.

### Hurdle 5 — Dev-loop friction (MFA)

Every smoke test required MFA. Codes only appeared in workflow logs, log files refresh on a schedule, and the test cycle ground to a halt for ~10 minutes per cycle until I bypassed MFA via SQL. Small per-incident, real over the build's life.

### Hurdle 6 — Silent failures

A wrong-schema write does not throw. There was no automatic check anywhere in the stack that said "this table is per-tenant, you must be in a tenant context to query it." Verification happened by hand. That's how silent corruption sneaks in.

---

## Part 2 — Where Earlier Oversight Would Have Saved the Most Time

These are the questions I wish had been asked at the *very first* architecture conversation, not at Stage 4. Each one is high-leverage: 10 minutes of conversation up front, hours-to-days of refactor avoided later.

### Q1. "Is this app multi-tenant? If yes, prove the isolation model on day one — even with one tenant."

**Single highest-leverage question for any SaaS build.**

If we had built tenant routing into the `db` import on day one — even just a `tenantSlug` threaded through every query against a single shared schema — Stage 4 would have been a one-line change ("swap shared schema for per-tenant schema") instead of a 13-library refactor.

Ask this *before* the first real feature ships.

### Q2. "What goes in 'global' tables vs. 'per-tenant' tables? Write the list down."

We never explicitly drew that line, so per-tenant data leaked into `public` for months. Ten minutes of conversation up front would have prevented the entire cleanup pass.

For SAMA the right answer turned out to be:
- **Global:** `tenants`, `tenant_users`, `tiers`, `users`, `email_verifications`, `webhook_events`, `injections`
- **Per-tenant:** everything else (22 tables)

That list should exist in `replit.md` from week one.

### Q3. "Show me a working second tenant before we add the next feature."

The reason `orbital`, `helvetia`, and `orbital-test` were sitting empty in the DB is that we kept building features against ACME alone. If we had forced ourselves to make every new feature work for two tenants from day one, isolation bugs would have surfaced immediately instead of compounding silently.

Heuristic: **a "multi-tenant" app with one real tenant is a single-tenant app with extra tables.**

### Q4. "What's the dev-loop friction budget?"

MFA, manual login, log-file refresh delays, having to re-authenticate for every smoke test — none of those are wrong, but together they slowed every iteration. Worth asking early:

> "What concessions are we making in dev for production safety, and is there a dev-only bypass?"

A `DEV_MFA_CODE=000000` env var, or a `/dev/mfa-bypass` endpoint gated on `NODE_ENV !== 'production'`, would have saved hours.

### Q5. "When something silently fails, how would we know?"

A lot of the risk in this migration was that wrong-schema writes don't throw — they go to the wrong place. Asking up front *"how do we make silent corruption loud?"* drives you toward:
- Row-level `tenant_id` checks in middleware
- A DB client that refuses to query per-tenant tables outside a tenant context
- Audit logs comparing schema state across tenants
- Assertion middleware that throws on cross-tenant reads

We had none of those, so I had to verify by hand at every step.

### Q6. "Smaller, narrower checkpoints."

"Stage 4" turned into a ~600-line diff across 22 files. If we had broken it into:
1. **4A:** provision schemas (no behavior change)
2. **4B:** route writes to per-tenant schema, leave reads on public
3. **4C:** route reads to per-tenant
4. **4D:** drop public copies

…each could have been smoke-tested and merged independently, and a regression would have been bisectable to one phase. The pressure to "push through 4B/4C this session" meant the safety net was thinner than ideal — it worked out, but it's not a habit to repeat.

---

## Part 3 — The Day-One Checklist for the Next SaaS Build

Use this on day one, before the first real feature ships. Each item is a question to answer in writing, not a vibe to gesture at.

### Tenancy

- [ ] **Is this app multi-tenant?** (yes/no — write it down)
- [ ] If yes, **list every table that is global vs. per-tenant.** Save the list.
- [ ] Pick the isolation model: shared schema + `tenant_id` column, schema-per-tenant, or DB-per-tenant. Write down *why.*
- [ ] Build the `db` client with tenant routing baked in from the first commit, even if there's only one tenant.
- [ ] Make the client **refuse** to query a per-tenant table without a tenant context. This is your guardrail against silent corruption.
- [ ] Seed two real tenants from day one. Make every feature demo work for both.

### Auth & Sessions

- [ ] Decide where the tenant context comes from (subdomain? JWT claim? path param?). Write it down.
- [ ] Decide how that context propagates into background workers (explicit arg? job payload? ALS?).
- [ ] Provide a dev-mode auth bypass (`DEV_LOGIN_AS=foo@bar.com`) that is **physically impossible** in production (`NODE_ENV` gate + assertion at boot).

### Background Work

- [ ] List every code path that runs **outside a request:** workers, cron, fire-and-forget promises, webhooks, boot-time seeders.
- [ ] For each, write down how it gets tenant context. If the answer is "it's a global thing," confirm it doesn't touch per-tenant tables.

### Observability

- [ ] How do you make silent failures loud? Write down at least one mechanism per category:
  - Wrong-schema write
  - Cross-tenant read
  - Missing tenant context
  - Unhandled rejected promise
- [ ] Logs should always include `tenantId` / `tenantSlug` / `requestId`. Set this up in middleware, not in handlers.

### Migration Discipline

- [ ] Big refactors land in **phases of <300 lines** each, every phase merged + smoke-tested independently.
- [ ] Every migration phase has a written rollback step.
- [ ] Keep a `pre-stageN-backup-{schema,data}.sql` for any phase that touches data shape.

### Documentation

- [ ] `replit.md` carries the global vs. per-tenant table list, the auth model, and the tenancy model.
- [ ] Update it the same commit you change architecture, not later.

---

## Part 4 — The One Thing

If you take nothing else from this:

> **On day one, write down which tables are global and which are per-tenant, and make the database client refuse to query a per-tenant table without a tenant context.**

That single guardrail would have eliminated 80% of the work in Stage 4 and 100% of the silent-corruption risk. Everything else in this document is downstream of that decision.
