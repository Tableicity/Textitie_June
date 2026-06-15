---
name: Prod schema provisioning & ownership boundary
description: How schema changes reach the prod DB (Replit managed Postgres, Publish-time auto-diff) and the agent's read-only prod boundary.
---

# Prod schema provisioning & ownership boundary

**Rule:** This project uses Replit **managed Postgres** — `DATABASE_URL` is a **runtime-managed**
secret, and development and production are **separate managed databases**. Production schema is
updated **automatically by the Publish flow**: on Publish, Replit introspects dev + prod, computes a
SQL diff, asks the owner to confirm any renames, and applies the diff to the prod database. There is
**no** custom migration step, **no** deploy-build hook, and **no** need for startup DDL.

To ship a schema change to prod: edit the Drizzle schema (source of truth) → push to the **dev** DB
(`pnpm --filter @workspace/db run push-force`) → verify in dev → **re-publish**. Renames or
destructive alters surface a confirmation prompt in the Publish UI.

**Do NOT (documented anti-patterns):** write a prod migration script (`migrate-prod.*`), add
`db:push`/`drizzle-kit push` to a deploy build command, add startup `CREATE TABLE/ALTER ... IF NOT
EXISTS` to "self-heal" prod, or try DDL via `executeSql({environment:"production"})` (prod is
read-only). If prod is missing a column/table, the fix is **re-publish**, never a script.

**Why:** A prior session believed "the deploy has no migration step, dev/prod are separate, so the
only way to get a table into prod is idempotent boot DDL + fail-fast." That premise was **wrong** for
managed Postgres. Verified 2026-06-15: immediately after a publish, dev and prod `public` schemas
were byte-identical (310 columns each, zero drift) with no boot-DDL or manual push involved — the
Publish diff did it. The existing `ensurePhoneNumbersSchema()` boot DDL predates this understanding;
it is now redundant belt-and-suspenders (idempotent, harmless) — leave it, but don't grow the pattern.

**How to apply:**
- Schema change → Drizzle schema → dev push → verify in dev → re-publish. That's the whole path.
- Agent has **read-only** prod access (`executeSql({environment:"production"})` = SELECT only). Use it
  to verify a deploy (e.g. diff `information_schema.columns` dev vs prod), never to mutate.
- Prod **data** writes/destructive ops go through an authenticated Conductor app endpoint, never raw
  SQL. (Pattern that worked for hard-deleting a tenant: caller echoes a confirmation token = the slug,
  one transaction deletes FK children in dependency order, refuses protected seed tenants like `acme`.)
- Publish migrates **schema**, not data. Dev test data does not flow to prod unless the owner picks
  the Publish UI's explicit "overwrite data" option.
