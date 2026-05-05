# Project SAMA — Control Plane & User Messaging

## Overview
Project SAMA (Simple but Advanced Messaging Alternative) is a multi-tenant control plane designed for robust, scalable, and intelligent communication management. It features a Master Conductor for overseeing tenants, injecting messages, and monitoring webhooks. Key capabilities include multi-tenant management, an AI-powered knowledge base, a user-friendly messaging inbox for customer agents, and comprehensive compliance features. SAMA aims to revolutionize business communication by offering a sophisticated yet easy-to-use platform.

## User Preferences
No specific user preferences were provided in the original document.

## System Architecture

### Core Architecture
-   **Monorepo**: Utilizes a pnpm workspace.
-   **Contract-first API Design**: OpenAPI (`lib/api-spec/openapi.yaml`) defines API specifications, generating client code and Zod schemas.
-   **Database**: PostgreSQL with Drizzle ORM. **Schema-per-tenant isolation (Stage 4)**: each tenant's per-tenant data lives in a dedicated `tenant_<slug>` Postgres schema. Globals (`tenants`, `tenant_users`, `tiers`, `users`, `email_verifications`, `webhook_events`, `injections`) remain in `public`. The middleware `requireTenantAuth` resolves the tenant slug from the JWT and runs the rest of the request inside an `AsyncLocalStorage` context (`tenantSlugStore`); the `db`/`pool` exports from `@workspace/db` are Proxies that read that context, so route-level direct queries route to the correct schema with no per-call edits. Library functions that run outside a request (workers, fire-and-forget jobs) accept an explicit `tenantSlug` and use `getTenantDb(slug)` / `getTenantPool(slug)` directly. Schema provisioning is handled by `ensureTenantSchema(slug)` and the `scripts/provision-tenant-schemas` / `scripts/backfill-tenant-schemas` scripts (idempotent).
-   **API Server**: Express.js application (`artifacts/api-server`).
-   **Admin UI**: React application (`artifacts/eng-architect`) using Vite, wouter, and shadcn, served at `/admin/`.
-   **User UI**: React application (`artifacts/user-app`) using Vite, wouter, and shadcn, providing a Textline-style messaging inbox, served at `/` (root).

### Key Features & Implementations
-   **Modular Sender Pipeline**: Pluggable interface for message sending.
-   **Conductor Authentication**: HTTP Basic Auth for admin APIs; Bearer tokens for admin, JWTs for tenant agents.
-   **Multi-Tenant Intelligence**: Inbound routing by tenant phone numbers, per-tenant `From` numbers for outbound messages, and Chatwoot integration.
-   **AI Student & Knowledge Base**: Tenants upload documents (PDF/TXT/MD/CSV) for an AI Student (GPT-4o-mini) to generate RAG-contextualized responses as private notes in Chatwoot.
-   **10DLC Compliance Monitoring**: Integrates with Twilio Trust Hub APIs for real-time compliance status.
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
    -   **HubSpot Connector (stub-first)**: Integration with HubSpot for CRM syncing (contacts, conversation activity) via a queue and a worker, with a simulation log for testing.
    -   **HIPAA Plan Flag**: Tier-based HIPAA eligibility with tenant-level `hipaaEnabled`, BAA acknowledgment, and PHI redaction in logs.
-   **Auto-Seed Strategy**: Idempotent seed data for consistent environment setup (tiers, demo tenants, departments, conversations, billing, etc.).

## External Dependencies

-   **Twilio**: Message sending, inbound routing, and 10DLC compliance.
-   **Chatwoot**: Sovereign bridging, conversation management, and AI-generated note posting.
-   **OpenAI**: `gpt-4o-mini` for the AI Student Whisperer.
-   **PostgreSQL**: Primary database.
-   **pdfjs-dist**: Used for text extraction from PDF files for the knowledge base.
## Stage 4 Multi-Tenancy Migration (in progress)

**Architecture:** Schema-per-tenant. Each tenant gets a `tenant_<slug>` Postgres schema; one Drizzle table-def set is reused with `search_path` per pooled connection. Cross-schema FKs into `public.tenants` and `public.tenant_users` are preserved.

**Phase 4A — Plumbing (DONE, verified)**
- `lib/db/src/tenant-db.ts` — `getTenantDb(slug)` factory, per-slug pool cache, validates slug shape, sets `search_path = tenant_<slug>, public` on every new connection.
- `lib/db/src/tenant-provisioner.ts` — `provisionTenantSchema(slug)` / `ensureTenantSchema(slug)` / `tenantSchemaExists(slug)`. Reads `tenant-schema-template.sql` and substitutes `__SCHEMA__`.
- `lib/db/src/tenant-schema-template.sql` — generated from `pg_dump --schema-only` of all 22 per-tenant tables in one invocation (so FKs resolve correctly), then sed-transformed: `public.X` → `__SCHEMA__.X`, with `public.tenants` and `public.tenant_users` restored.
- `middleware/tenantAuth.ts` — payload now includes `tenantSlug`, attaches `req.tenantDb` to every request, has 1-hour slug cache for legacy tokens (backward compat with sessions issued before 4A).
- `routes/tenantAuth.ts` — login/verify-mfa/register tokens all carry `tenantSlug`. Register calls `ensureTenantSchema(slug)` after tenant creation (catches errors so a provisioner failure doesn't block signup).
- `scripts/src/provision-tenant-schemas.ts` + npm script `provision-tenant-schemas`. All 4 existing tenants provisioned (acme, orbital, helvetia, orbital-test), 22 tables each.
- `scripts/src/backfill-tenant-schemas.ts` + npm script `backfill-tenant-schemas`. Idempotent INSERT...ON CONFLICT DO NOTHING with parent-before-child ordering and per-schema sequence advance (`setval` to MAX(id)+1).
- `John/pre-stage4-backup-schema.sql` + `John/pre-stage4-backup-data.sql` — full pg_dump backup taken before backfill.

**ACME backfill verified:** 94 rows copied, every one of 18 tenant tables shows public count == tenant_acme count.

**Phase 4B/4C — Route refactor (NOT STARTED)**
- 28 files in `artifacts/api-server/src/` reference per-tenant tables (`conversations.ts` alone has 151 references). Each must switch from `db.X.where(eq(X.tenantId, ...))` → `req.tenantDb.X` (no tenantId filter; schema isolation handles it).
- Webhook + survey-public routes (no `requireTenantAuth`) need to look up tenant from public, then call `getTenantDb(slug)`.
- Lib files (`automationEngine`, `timerEngine`, `audit`, `compliance`, `routing`, `surveyDispatcher`, `creditEngine`, `campaignEngine`, `seedData`, `stripe-stub`, `integrations/syncWorker`) need to accept slug and use `getTenantDb(slug)`.
- Estimated: 2–3 focused sessions; biggest files (`conversations.ts`, `campaigns.ts`, `automations.ts`, `automationEngine.ts`, `timerEngine.ts`, `surveyDispatcher.ts`, `syncWorker.ts`) should be split into separate sessions for review.
- DO NOT drop `tenant_id` columns from public tables yet; we still read from public until 4B is done.

**Files NOT in `public` per current plan:** tenants, tenant_users, email_verifications, tiers, users (legacy), webhook_events, injections.
