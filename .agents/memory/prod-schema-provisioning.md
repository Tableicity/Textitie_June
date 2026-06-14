---
name: Prod schema provisioning & ownership boundary
description: How schema changes reach the prod DB given no migration step, separate dev/prod DBs, and an agent that can only write dev.
---

# Prod schema provisioning & ownership boundary

**Rule:** Only the project owner can publish, and the agent can write **only** the dev database — prod is read-only to the agent. The autoscale deploy build runs **no migration step**, and dev/prod are **separate** databases, so `drizzle push` from the shell only ever touches dev. The only way the agent can ship a schema change to prod is **idempotent boot-time DDL** (an `ensure*Schema()` style `CREATE TABLE/INDEX IF NOT EXISTS` mirroring the Drizzle schema) that runs on startup — it lands in prod when the **owner publishes**, not before.

**Why:** At phone_numbers go-live, a fail-closed resolver was about to read a table that didn't exist in prod (it existed only in dev where `drizzle push` had run), which would have stalled all inbound. "push" never covers prod here.

**How to apply:**
- New table/index that prod needs → add idempotent boot DDL that runs **before** any code that reads it (and before backfill). No-op in dev.
- If the new table is **load-bearing** (some path fails closed against it), make the boot path **fail-fast in production**: if it's still missing after the schema check (e.g. prod role lacks `CREATE`), `process.exit(1)` rather than serve broken behavior. A loud crash-loop beats a silent stall. Non-prod logs and continues.
- The agent cannot verify or trigger prod itself — after coding, hand the publish to the owner, then verify via prod **read-only** SELECTs + prod boot logs.
- Prod **writes/destructive ops** must go through an authenticated app endpoint (Conductor), never raw SQL. Pattern that worked for hard-deleting a tenant: require the caller to echo a confirmation token (the slug), run one transaction deleting NO-ACTION FK children in dependency order, and refuse protected seed tenants (`acme`) that the seeder would just recreate.
