---
name: Drizzle wraps pg error codes
description: SQLSTATE (e.g. 23505) lives on err.cause, not err.code, after Drizzle wraps a driver error — a catch checking err.code silently never fires
---

# Drizzle wraps the driver error — SQLSTATE is on `err.cause`, not `err.code`

When a query throws (both the query builder `db.insert(...).returning()` and the
raw `db.execute(sql\`...\`)` path), drizzle-orm wraps the node-postgres error in a
`DrizzleQueryError`. The wrapper's own `.code` is undefined; the original pg error
(carrying `code: "23505"` etc.) sits on `err.cause`.

So a catch like `if ((err as {code?:string}).code === "23505")` **silently never
matches** — it compiles, passes typecheck, and looks correct, but the intended
409/branch never fires and the error rethrows as a 500. It only shows up if you
write a test that actually triggers a real DB unique violation through Drizzle
(a hand-thrown `{code:"23505"}` mock would hide the bug).

**Why:** the TextLine Smasher flip-live collision safety net (and the
start-migration duplicate-race 409) both checked `err.code` directly; a DB-backed
test of a genuine `contacts_tenant_phone_live_unq` violation proved the catch was
dead and the action 500'd instead of returning `status:"collision"` (→409).

**How to apply:** never match a SQLSTATE on `err.code` alone after a Drizzle
query. Walk the cause chain. In api-server use the exported helper
`pgErrorCode(err)` from `lib/migrationActions.ts` (loops `err` → `err.cause` a few
levels, returns the first string `code`). Pre-existing direct `.code === "23505"`
checks elsewhere (`routes/contacts.ts`, `dispositions.ts`, `auth.ts`,
`inboundStageStore.ts`) likely share this latent bug — verify against a real DB
violation before trusting them.
