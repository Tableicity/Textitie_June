# Textitie — Two-way SMS Platform (formerly Project SAMA)

## Overview
Textitie (internal codename "SAMA" — Simple but Advanced Messaging Alternative) is a multi-tenant control plane designed for robust, scalable, and intelligent communication management. The user-facing app is branded **Textitie**; the admin/control plane retains the "SAMA Control Plane" label internally. It features a Master Conductor for overseeing tenants, injecting messages, and monitoring webhooks. Key capabilities include multi-tenant management, an AI-powered knowledge base, a user-friendly messaging inbox for customer agents, and comprehensive compliance features. SAMA aims to revolutionize business communication by offering a sophisticated yet easy-to-use platform.

## User Preferences
- GitHub remote: `https://github.com/TransferAgent/textitie.git` (PAT stored in the `GITHUB_TEXTITIE` secret). For one-off pushes use:
  `git push "https://TransferAgent:${GITHUB_TEXTITIE}@github.com/TransferAgent/textitie.git" main`
- Status tracking is the agent's job, not the user's, and not a separate ledger. `replit.md` (this file) is the single source of truth for build status. The "Scaffolding" gate-ledger experiment (`Gate_Build.md` + `Regeneration.md`) was retired 2026-06-08 — it required manual reconciliation after every parallel task-agent merge and paid off only in friction; both are archived in `John/Archive/`. Do NOT recreate a gate ledger or ask the user to maintain build-status docs.
- `John/` keeps only living **operational** docs at its root: `Run_Book.md` (Twilio go-live runbook, secrets, diagnostics), `Hardening.md` (prod-hardening backlog), `Database_URL_work.md` (dev/prod DB split task), `architecture.doc.md` (append-only durable lessons). Update these when the relevant operational facts change — they are references, not a status ceremony.

## System Architecture

### Core Architecture
-   **Monorepo**: Utilizes a pnpm workspace.
-   **Contract-first API Design**: OpenAPI (`lib/api-spec/openapi.yaml`) defines API specifications, generating client code and Zod schemas.
-   **Database**: PostgreSQL with Drizzle ORM. **All data lives in the `public` schema** with explicit `tenant_id` scoping on every per-tenant table (`conversations`, `opt_outs`, `automation_rules`, `campaigns`, `reminders`, `audit_logs`, …); `messages` inherits scoping via `conversation_id`. Stage 4 schema-per-tenant isolation was attempted but only the inbound write path was migrated — the inbox UI continued reading `public.*`, which silently lost auto-replies and campaign attribution writes in any environment where the tenant schema actually existed. **Stage 4 is deferred** until we have a real isolation driver (SOC2/HIPAA/sovereign-data). `getTenantDb(slug)` and `getTenantPool(slug)` in `lib/db/src/tenant-db.ts` are now thin wrappers that return the global pool, so call sites do not need to change when we re-enable schema isolation later.
-   **Database environments & schema migration**: This project uses Replit **managed Postgres** (`DATABASE_URL` is runtime-managed); development and production are **separate** managed databases. Production schema is updated **automatically by the Publish flow** — on publish, Replit diffs the dev schema against prod and applies it (renames/destructive alters prompt for confirmation in the Publish UI). There is **no** custom migration step, deploy-build hook, or startup DDL needed. To ship a schema change to prod: edit the Drizzle schema → push to dev (`pnpm --filter @workspace/db run push-force`) → re-publish. Publish migrates **schema, not data** (dev test data does not flow to prod unless the owner picks the Publish UI's explicit "overwrite data" option). The agent has **read-only** access to prod (SELECT only); prod data writes go through the Conductor API, never raw SQL. (Verified 2026-06-15: immediately after a publish, dev and prod `public` schemas were identical — 310 columns each, zero drift.)
-   **API Server**: Express.js application (`artifacts/api-server`).
-   **Admin UI**: React application (`artifacts/eng-architect`) using Vite, wouter, and shadcn, served at `/admin/`.
-   **User UI**: React application (`artifacts/user-app`) using Vite, wouter, and shadcn, providing a Textline-style messaging inbox. Public marketing **Landing page is served at `/`**; the agent **Inbox lives at `/inbox`** (auth-gated). Other auth-gated routes: `/contacts`, `/settings`, `/billing`, `/automations`, `/campaigns`, `/analytics`, `/knowledge`. Public routes: `/login`, `/verify`, `/signup`, `/signup/trial`, `/privacy`, `/terms`. Auth-gated routes also include `/onboarding` (agent account setup, left-rail entry point).

### Key Features & Implementations
-   **Modular Sender Pipeline**: Pluggable interface for message sending.
-   **Conductor Authentication**: HTTP Basic Auth for admin APIs; Bearer tokens for admin, JWTs for tenant agents.
-   **Multi-Tenant Intelligence**: Inbound routing by tenant phone numbers, per-tenant `From` numbers for outbound messages, and Chatwoot integration.
-   **Halo AI Whisperer & Knowledge Base**: Tenants upload documents (PDF/TXT/MD/CSV, ≤5 MB) at `/knowledge` for **Halo AI** (OpenAI `gpt-4o-mini`) to generate RAG-contextualized response drafts as private notes in Chatwoot. Upload endpoint `POST /api/tenants/:id/knowledge-upload` is gated by `requireTenantAuth` and enforces tenant-scope (`tenantUser.tenantId === :id`). The inbox "Halo AI" button is currently a placeholder dialog pending wiring to the live draft API.
-   **10DLC Compliance Monitoring**: Integrates with Twilio Trust Hub APIs for real-time compliance status. A2P 10DLC consent disclosure is rendered on both the Login (left + right panes) and Signup (right pane) screens to satisfy Twilio Error 30491 review requirements.
-   **Conversation Management**: Features for claiming, transferring, unassigning, and event management.
-   **Department & Agent Management**: Creation of departments, phone number assignment, agent roles, statuses, skills, languages, and routing strategies.
-   **UI/UX**: React-based UIs with distinct branding, themes, and a two-panel inbox with agent status indicators.
-   **Billing & Subscriptions**: Stripe billing (stubbed) with subscription plans, per-message credit model, usage metering, and free trial.
-   **Automations & Shortcuts**: Automation rules (keyword replies, follow-ups, auto-resolve, welcome messages, opt-out) and message templates (shortcuts) with UI management.
-   **Analytics & Insights**: Tenant-facing dashboard at `/analytics` with key performance indicators (KPIs) like total/open/closed conversations, response times, message counts, per-agent/department metrics, and CSV export. KPIs are computed on-the-fly from conversation and message data.
-   **Advanced Inbox Features**:
    -   **Whispers**: Internal notes (`messages.direction='internal'`) visible only to agents.
    -   **Dispositions**: Tenant-scoped resolution categories for conversations.
    -   **Contact Management & Tagging**: Tenant-scoped contact management with searchable lists, tags, and conversation history.
    -   **Conversation Search & Filtering**: Extended `GET /conversations` with various query parameters.
    -   **Reminders**: Tenant-scoped, per-user, conversation-linked reminders with notifications.
-   **Surveys (CSAT)**: One-tap customer satisfaction surveys delivered via SMS after conversation closure. Includes schema for surveys, sends, and responses, with auto-sending, a public response page, and dedicated analytics.
-   **Campaigns**: Bulk SMS campaigns with audience segmentation, variable injection, credit checks, segment-aware billing, and rate-limited delivery. Features include scheduling, Twilio delivery webhooks, and last-touch attribution for responses and opt-outs.
-   **Integrations & Compliance**:
    -   **Audit Log**: Comprehensive `audit_logs` table for tracking actions, indexed by entity, action, and timestamp.
    -   **TCPA Compliance Enhancements**: `opt_ins` table, tenant-level quiet hours, frequency caps, and double opt-in requirements. Outbound compliance checks prevent sending messages violating these rules.
    -   **Contact Block (two-way)**: When a contact is blocked (`contacts.blocked = true`, tenant-scoped on `tenant_id` + `phone`), outbound sends are rejected by `checkOutboundCompliance` and the contact is excluded from campaigns. Inbound is also enforced in `routes/webhooks.ts`: a text from a blocked number is **dropped** before it reaches agents (no Chatwoot forward, no Halo AI whisper, no conversation create/update, no realtime push, no automation/attribution). The drop is **not silent for audit** — an `inbound.blocked` `audit_logs` row (with a 500-char body preview) plus the raw `webhook_events` record (`_sama.blocked = true`) preserve a trail.
    -   **Blocked Activity Review**: The `/contacts` page has a "Blocked" view (toggle in the header) that lists currently-blocked numbers with their suppressed-inbound stats — attempt count, last attempt time, and the most recent dropped message preview — sourced from `audit_logs` (`action='inbound.blocked'`, `entity_id` = sender phone) joined to blocked `contacts`. Endpoint: `GET /contacts/blocked-activity` (`requireTenantAuth`, tenant-scoped). Agents can unblock directly from the row, which reuses `POST /contacts/block` with `blocked:false`; after unblock the number's inbound texts flow normally again.
    -   **HubSpot Connector (stub-first)**: Integration with HubSpot for CRM syncing (contacts, conversation activity) via a queue and a worker, with a simulation log for testing.
    -   **HIPAA Plan Flag**: Tier-based HIPAA eligibility with tenant-level `hipaaEnabled`, BAA acknowledgment, and PHI redaction in logs.
-   **Auto-Seed Strategy**: Idempotent seed data for consistent environment setup (tiers, demo tenants, departments, conversations, billing, etc.).

## External Dependencies

-   **Twilio**: Message sending, inbound routing, and 10DLC compliance.
-   **Chatwoot**: Sovereign bridging, conversation management, and AI-generated note posting.
-   **OpenAI**: `gpt-4o-mini` for the AI Student Whisperer.
-   **PostgreSQL**: Primary database.
-   **pdfjs-dist**: Used for text extraction from PDF files for the knowledge base.
## Stage 4 Multi-Tenancy Migration (DEFERRED)

**Status:** Rolled back at the data layer. Schema-per-tenant was a half-finished migration: webhook writes went through `tenant_<slug>.*` while the inbox kept reading `public.*`, so auto-replies, opt-outs, and campaign attribution silently disappeared whenever the tenant schema actually existed. Production "worked" only because the prod database never had `tenant_<slug>` schemas, so `search_path` fell through to `public`. Dev kept breaking because the schemas existed.

**Current state:** `lib/db/src/tenant-db.ts` `getTenantDb`/`getTenantPool` return the global pool. All call sites (`webhooks.ts`, `automationEngine.ts`, `campaignAttribution.ts`, audit, routing, sync worker, surveys) now read and write the same `public.*` rows, scoped by `tenant_id`. The slug parameter is preserved and still validated so we can re-enable per-tenant routing by changing only `tenant-db.ts` if a future compliance requirement demands DB-level isolation.

**Original plumbing (still on disk, unused — kept for the future re-enablement path):**
- `lib/db/src/tenant-provisioner.ts` + `tenant-schema-template.sql` — schema cloning machinery.
- `scripts/src/provision-tenant-schemas.ts` + `scripts/src/backfill-tenant-schemas.ts` — npm scripts to clone/backfill `tenant_<slug>.*` from `public.*`. Safe to run, but the app no longer reads from those schemas.
- `John/pre-stage4-backup-schema.sql` + `John/pre-stage4-backup-data.sql` — pg_dump backup taken before the backfill.
- The `tenant_acme`, `tenant_orbital`, `tenant_helvetia`, `tenant_orbital_test` schemas in dev are dormant — they hold a snapshot of pre-rollback data and can be dropped at any time.

**Re-enablement checklist (when isolation is actually required):**
1. Restore the `search_path` logic in `lib/db/src/tenant-db.ts` (one file).
2. Re-run `provision-tenant-schemas` + `backfill-tenant-schemas` against the target environment.
3. Switch the inbox read path (`routes/conversations.ts`, `routes/messages.ts`) to use `getTenantDb(slug)` so reads and writes hit the same schema.
4. Drop the now-redundant `tenant_id` filters in queries that move into a tenant schema.
