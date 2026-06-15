# DATABASE_URL Separation — Dev vs Production

**Date:** May 4, 2026
**Project:** SAMA Control Plane
**Status:** ❌ OBSOLETE — DO NOT FOLLOW (resolved 2026-06-15)

> **This plan is unnecessary and following it would BREAK the app.** This project uses Replit
> **managed Postgres**: `DATABASE_URL` is a **runtime-managed** secret and dev/prod are already
> **separate** managed databases. Schema reaches prod automatically via the **Publish-time schema
> diff** (verified 2026-06-15: dev and prod `public` schemas were identical immediately after a
> publish — 310 columns each). Do **NOT** delete or re-scope `DATABASE_URL`; it is managed by Replit
> and deleting it would take down both environments. Kept for historical context only. See
> `replit.md` → "Database environments & schema migration".

---

## The Problem

Right now, `DATABASE_URL` is a single shared secret in Replit. The same value is used in both development and production. This means:

- Dev schema pushes (`drizzle-kit push`) and the running production server hit the **same database**.
- There is no guardrail preventing accidental schema changes to the production database during development.
- If you change the secret to point to a different database, both environments switch at the same time.

You confirmed that you have **two separate PostgreSQL databases** (dev and production), but the Replit configuration doesn't enforce this separation today.

---

## Why It Matters

| Risk | Impact |
|---|---|
| Running `drizzle-kit push` in dev accidentally targets production | Schema corruption or data loss in production |
| Production server restarts and connects to the dev database | Production users see test data or incomplete schema |
| No way to test schema changes safely before deploying | Every schema change is a live push to whatever DATABASE_URL points to |
| Super user seed runs against the wrong database | Credentials created in the wrong environment |

---

## What We Want

- **Development environment** uses the dev database automatically.
- **Production environment** uses the production database automatically.
- No manual URL swapping. No chance of cross-contamination.
- Shell commands (`drizzle-kit push`, seed scripts) target the dev database by default.
- Publishing targets the production database by default.

---

## How Replit Environment Variables Work

Replit has three scopes for environment variables:

| Scope | Available in Dev | Available in Production | Use Case |
|---|---|---|---|
| **Shared** | Yes | Yes | Values that are the same in both environments |
| **Development** | Yes | No | Dev-only config (dev database, debug flags) |
| **Production** | No | Yes | Prod-only config (production database, stricter settings) |

**Key rule:** A variable cannot exist in both "shared" and a specific environment at the same time. To split a shared variable, you must delete it from shared first, then re-add it to development and production separately.

**Secrets vs Env Vars:** Secrets are always global (shared). They cannot be scoped per environment. Environment variables CAN be scoped. The trade-off is that env vars are visible in the Replit GUI, while secrets are hidden. For a database URL containing credentials, this is a minor concern since only you (the project owner) can see them.

---

## Step-by-Step Plan

### Step 1: Gather Both Database URLs

Before making any changes, have both connection strings ready:

- **Dev database URL** — the one you use during development
- **Production database URL** — the one your live app should use

You can find the current value in the Replit Secrets panel.

### Step 2: Delete the Shared DATABASE_URL Secret

In the Replit Secrets panel:

1. Find `DATABASE_URL` in the secrets list
2. Delete it

**What happens:** Both dev and production will temporarily lose access to `DATABASE_URL`. The dev server will crash on restart until we add the new values. This is expected — we'll fix it in the next steps.

### Step 3: Set DATABASE_URL as a Development Environment Variable

Using the Replit Secrets/Environment panel:

1. Switch to the "Development" environment tab
2. Add `DATABASE_URL` with your **dev database** connection string

**What happens:** The dev server, shell commands, and `drizzle-kit push` will now always target the dev database.

### Step 4: Set DATABASE_URL as a Production Environment Variable

Using the Replit Secrets/Environment panel:

1. Switch to the "Production" environment tab
2. Add `DATABASE_URL` with your **production database** connection string

**What happens:** When you publish, the production server will use the production database. Schema checks and super user seeding at startup will target the correct database.

### Step 5: Restart the Dev Server

After setting both values:

1. Restart the API Server workflow
2. Verify the startup logs show "Schema check passed" and "Super user already exists"
3. Confirm the dev app works (login, view tenants, etc.)

### Step 6: Push Schema to Production (if needed)

If the production database is behind on schema:

```bash
pnpm --filter @workspace/db run push-force
```

This command runs in the shell, which is the **development environment**, so it will push to the **dev database** by default. To push to production, you would need to override:

```bash
DATABASE_URL="<production-url>" pnpm --filter @workspace/db run push-force
```

### Step 7: Re-publish and Verify

1. Publish the app
2. Check `https://textitie.replit.app/api/healthz` returns `{"status":"ok"}`
3. Check production deployment logs for "Schema check passed"
4. Log in to production and verify everything works

---

## After Separation: Day-to-Day Workflow

| Action | Database Targeted | Why |
|---|---|---|
| `pnpm --filter @workspace/db run push-force` (in shell) | Dev | Shell runs in development environment |
| Server startup in dev | Dev | Dev environment variable |
| Publish / production server | Production | Production environment variable |
| Manual prod schema push | Production (override) | You explicitly pass the prod URL |

---

## Other Variables to Consider

While we're separating environments, consider whether these should also be split:

| Variable | Current Scope | Should Split? | Reason |
|---|---|---|---|
| `DATABASE_URL` | Shared secret | **Yes** | Different databases for dev and prod |
| `SESSION_SECRET` | Shared secret | Maybe | Different signing keys per environment adds security |
| `CONDUCTOR_PASSWORD` | Shared secret | Maybe | Could use a weaker password in dev for convenience |
| `SUPERUSER_EMAIL` | Shared env var | No | Same super user in both environments |
| `SUPERUSER_PASSWORD` | Shared env var | Maybe | Could use a simpler dev password |
| `TWILIO_*` | Shared secrets | Maybe | Could use test credentials in dev to avoid sending real SMS |
| `CHATWOOT_*` | Shared secrets | No | Same sovereign node for both |
| `OPENAI_API_KEY` | Shared secret | No | Same key works everywhere |

---

## Rollback Plan

If anything goes wrong:

1. Delete the scoped `DATABASE_URL` from both development and production
2. Re-add `DATABASE_URL` as a shared secret with the original value
3. Restart the dev server

This puts you back to exactly where you are today.
