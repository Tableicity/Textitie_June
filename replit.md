# Textitie — Two-way SMS Platform (codename SAMA)

## Overview
Textitie (internal codename "SAMA" — Simple but Advanced Messaging Alternative) is a multi-tenant, compliance-first conversational SMS platform. Tenants get a Textline-style agent inbox; the platform operator gets a Master Conductor (the "SAMA Control Plane") for tenant management, message injection, phone-number provisioning, and webhook monitoring. Intelligence comes from a per-tenant Grok-powered knowledge pipeline (Knowledge Base → Library → Professor → Classroom → Student).

> **The full, granular build report — every feature, route, the Professor/Student interactions, and the engagement-mode gate — lives in [`README.md`](README.md).** This file holds the architecture essentials, user preferences, and operational facts the agent needs; it is intentionally lean. Keep it that way.

## User Preferences
- GitHub remote: `https://github.com/Tableicity/Textitie_June.git` (this is the live `origin`; PAT stored in the `GITHUB_TEXTITIE_JUNE` secret, which authenticates as a **Tableicity** account that has write access). For one-off pushes use:
  `git push "https://x-access-token:${GITHUB_TEXTITIE_JUNE}@github.com/Tableicity/Textitie_June.git" main`
  Gotcha: the older `GITHUB_TEXTITIE` secret is a **TransferAgent**-account PAT for a *separate* `TransferAgent/textitie` repo; it does NOT have write access to `Tableicity/Textitie_June` and pushing it there fails with `Permission denied to TransferAgent`. Use `GITHUB_TEXTITIE_JUNE` for the canonical repo.
- Status tracking is the agent's job, not the user's, and not a separate ledger. `replit.md` (this file) is the single source of truth for build status. The "Scaffolding" gate-ledger experiment (`Gate_Build.md` + `Regeneration.md`) was retired 2026-06-08 — it required manual reconciliation after every parallel task-agent merge and paid off only in friction; both are archived in `John/Archive/`. Do NOT recreate a gate ledger or ask the user to maintain build-status docs.
- `John/` keeps only living **operational** docs at its root: `Run_Book.md` (Twilio go-live runbook, secrets, diagnostics), `Hardening.md` (prod-hardening backlog), `Database_URL_work.md` (dev/prod DB split task), `architecture.doc.md` (append-only durable lessons). Update these when the relevant operational facts change — they are references, not a status ceremony.

## System Architecture

### Core
-   **Monorepo**: pnpm workspace (`artifacts/*` deployables, `lib/*` shared libs, `scripts/`).
-   **Contract-first API**: OpenAPI (`lib/api-spec/openapi.yaml`) generates the typed React Query client (`lib/api-client-react`) + Zod schemas (`lib/api-zod`). Regenerate with `pnpm --filter @workspace/api-spec run codegen`. Use **verb-first operationIds** to avoid Orval symbol mangling.
-   **API server**: Express.js + TypeScript (`artifacts/api-server`); one router mounted under `/api` (`src/routes/index.ts`). Conductor routes use HTTP Basic; tenant routes use `requireTenantAuth` (JWT). Never `console.log` in server code — use `req.log` / the singleton `logger`.
-   **Admin UI**: React + Vite + wouter + shadcn (`artifacts/eng-architect`), served at `/admin/`.
-   **User UI**: React + Vite + wouter + shadcn (`artifacts/user-app`). Public Landing at `/`; agent Inbox at `/inbox`. Other auth-gated routes: `/contacts`, `/settings`, `/billing`, `/automations`, `/campaigns`, `/analytics`, `/knowledge`, `/profile`, and the `/onboarding/*` flow. Public: `/login`, `/verify`, `/signup`, `/signup/trial`, `/privacy`, `/terms`.

### Database
-   **PostgreSQL + Drizzle ORM.** All data lives in the `public` schema with explicit `tenant_id` scoping on every per-tenant table (`conversations`, `opt_outs`, `automation_rules`, `campaigns`, `reminders`, `audit_logs`, knowledge tables, …); `messages` inherits scoping via `conversation_id`.
-   **DO NOT add a DB CHECK / enum constraint for free-form classification columns** (e.g. `category`, `region`): a single invalid row 500s the whole list endpoint when the route returns raw Drizzle rows. Use a plain text column + app-level validation + a safe fallback.
-   **Database environments & schema migration**: Replit **managed Postgres** (`DATABASE_URL` is runtime-managed); development and production are **separate** managed databases. Production schema is updated **automatically by the Publish flow** — on publish, Replit diffs the dev schema against prod and applies it (renames/destructive alters prompt for confirmation in the Publish UI). There is **no** custom migration step, deploy-build hook, or startup DDL. To ship a schema change to prod: edit the Drizzle schema → push to dev (`pnpm --filter @workspace/db run push-force`) → re-publish. Publish migrates **schema, not data**. The agent has **read-only** access to prod (SELECT only); prod data writes go through the Conductor API, never raw SQL.

### LLM knowledge pipeline (Grok / xAI)
Per-tenant flow **Knowledge Base → Library → Professor → Classroom → Student**, powered by **Grok (xAI)** via its OpenAI-compatible API (`baseURL https://api.x.ai/v1`, key in the `GROK_KEYS` secret; client in `artifacts/api-server/src/lib/grokClient.ts`). Two roles: a reasoning **Professor** (`grok-4.3`, override `SAMA_PROFESSOR_MODEL`) and a fast **Student** (`grok-4.20-0309-non-reasoning`, override `SAMA_STUDENT_MODEL`). **When `GROK_KEYS` is unset both degrade to a stub** so inbound SMS never breaks. Postgres full-text retrieval only (tsvector + GIN) — **no vectors**.

Key files: `artifacts/api-server/src/lib/knowledge.ts` (Library, extraction, `retrieveClassroomFacts`, `classifyQueryCategory`, `hasUnresolvedConflicts`), `lib/librarian.ts` (push-time dedup/conflict adjudication), `routes/knowledge.ts` (Conductor + tenant routes), `routes/webhooks.ts` (Student pipeline), `lib/ai-student/src/index.ts` (Student prompt + `parseStudentSections`), `lib/engagementPolicy.ts` (`evaluateAutoSend`), `lib/outboundReply.ts` (`sendConversationReply`), `eng-architect/src/pages/Professor.tsx` (Professor UI). Schema: `lib/db/src/schema/knowledge.ts`.

Agent-critical behavior (full detail in README):
-   **Facts** carry a `category` (`pricing|compliance|features|technical_setup|general`, app-validated, `general` fallback) and a status (`draft` → `published`, plus `conflict`). The Facts GET returns **raw Drizzle rows with no mapper** — any new column must also be added (required, correct nullability) to the OpenAPI schema or the generated UI type won't expose it.
-   **Engagement mode**: per-tenant `tenants.engagementMode` (`assisted` default | `gated_auto`). In `gated_auto`, auto-send fires only when the **fail-closed** `evaluateAutoSend` passes EVERY condition (grounded in Classroom, confidence=high, KB matched, safe category, no unresolved conflict, outbound compliance OK). Compliance is **re-checked at send time** in `sendConversationReply`. Auto-send is **idempotent** via `ai_auto_replies` (unique `(tenant_id, inbound_sid)`); a failed send releases the claim so a webhook retry can re-attempt. The Student + gate + auto-send run inside the durable fire-and-forget pipeline in `routes/webhooks.ts`, **off the inbound 200 path**, after the automation engine (gated on `!result.handled`).
-   **Backward compatibility**: the legacy `tenants.knowledge_base` text column is **retained** as the Student's fallback when a tenant has no published Classroom. The tenant `/knowledge` page and its upload endpoint still exist, and the inbox **"Halo AI" button is still a placeholder** pending wiring to the live Student draft API.

## External Dependencies
-   **Twilio** — outbound SMS, inbound routing, status callbacks, 10DLC compliance, number provisioning.
-   **xAI (Grok)** — Professor + Student LLM roles (`GROK_KEYS`).
-   **Stripe** — subscription checkout (real, wired) + billing; plan changes/metering via a credit-model stub.
-   **Chatwoot** — sovereign conversation bridging; private-note (whisper) and public-message mirroring.
-   **HubSpot** — stub-first CRM connector (queue + worker).
-   **PostgreSQL** — primary datastore.
-   **pdfjs-dist** — PDF text extraction for the knowledge Library.

## Stage 4 Multi-Tenancy Migration (DEFERRED)
Schema-per-tenant isolation was rolled back at the data layer: webhook writes went to `tenant_<slug>.*` while the inbox kept reading `public.*`, so auto-replies, opt-outs, and campaign attribution silently disappeared wherever the tenant schema actually existed. Prod "worked" only because it never had `tenant_<slug>` schemas (so `search_path` fell through to `public`); dev kept breaking because the schemas existed.

**Current state:** `lib/db/src/tenant-db.ts` `getTenantDb(slug)` / `getTenantPool(slug)` are thin wrappers that return the **global pool**, so call sites don't change when isolation is re-enabled. All read/write paths use `public.*` scoped by `tenant_id`. The slug param is preserved + validated so per-tenant routing can be re-enabled by changing only `tenant-db.ts`.

**Re-enablement (only when isolation is actually required — SOC2/HIPAA/sovereign-data):** restore the `search_path` logic in `tenant-db.ts`; re-run `scripts/src/provision-tenant-schemas.ts` + `backfill-tenant-schemas.ts`; switch the inbox read path (`routes/conversations.ts`, `routes/messages.ts`) to `getTenantDb(slug)`; drop the now-redundant `tenant_id` filters in queries that move into a tenant schema. Original plumbing (provisioner, template SQL, backfill scripts, pre-rollback pg_dump backups in `John/`) is still on disk, unused. The dormant `tenant_*` schemas in dev hold a pre-rollback snapshot and can be dropped anytime.
