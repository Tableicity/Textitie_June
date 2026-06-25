# Textitie

> Two-way SMS for teams that actually answer.

**Live:** https://textitie.com
**Internal codename:** SAMA (Simple but Advanced Messaging Alternative)
**Status:** In production · Stripe Checkout live · AI knowledge pipeline live (Professor on OpenRouter/Qwen, Student on Grok) · awaiting first live Twilio number for full end-to-end SMS go-live

Textitie is a multi-tenant, compliance-first conversational SMS platform. Each tenant gets a Textline-style agent inbox; the platform operator gets a **Master Conductor** (the SAMA Control Plane) for tenant management, message injection, phone-number provisioning, and webhook monitoring.

The platform's intelligence is a per-tenant **knowledge pipeline** — *Knowledge Base → Library → Professor → Classroom → Student*. A heavy-reasoning **Professor** (OpenRouter/Qwen) curates tenant knowledge and rescues ungrounded questions in real time; a fast **Student** (Grok) runs on every inbound SMS to draft a grounded reply. Each conversation runs in one of three **engagement modes** — **Manual** (AI off), **Co-Pilot** (the AI drafts, a human sends), or **Auto-Pilot** (the AI may send by itself when a strict fail-closed gate passes).

---

## Table of contents

- [Architecture at a glance](#architecture-at-a-glance)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Routes](#routes)
  - [User app](#user-app-textitiecom)
  - [Admin Conductor](#admin-conductor-textitiecomadmin)
  - [API surface](#api-surface-api)
- [LLM knowledge pipeline](#llm-knowledge-pipeline)
  - [Models & fallback](#models--fallback)
  - [Library](#1-library--ingestion--indexing)
  - [Professor interactions](#2-professor--operator-curation)
  - [Classroom & the Librarian](#3-classroom--the-librarian-dedup--conflict)
  - [Student interactions](#4-student--inbound-drafting)
  - [Engagement mode & auto-send gate](#5-engagement-mode--the-auto-send-gate)
- [Key features](#key-features)
- [Billing & phone numbers](#billing--phone-numbers)
- [Compliance](#compliance)
- [External dependencies](#external-dependencies)
- [Documentation](#documentation)
- [Deployment](#deployment)

---

## Architecture at a glance

- **Monorepo** — pnpm workspaces
- **Contract-first API** — OpenAPI (`lib/api-spec/openapi.yaml`) generates the typed React Query client + Zod schemas
- **Database** — PostgreSQL via Drizzle ORM. All data lives in the `public` schema with explicit `tenant_id` scoping on every per-tenant table. Schema-per-tenant isolation (Stage 4) is intentionally deferred — see `replit.md`.
- **API server** — Express.js + TypeScript (`artifacts/api-server`), one router mounted under `/api`
- **User UI** — React + Vite + wouter + shadcn (`artifacts/user-app`, Textitie brand) — public landing at `/`, agent inbox at `/inbox`
- **Admin UI** — React + Vite + wouter + shadcn (`artifacts/eng-architect`, SAMA brand) — served at `/admin/`
- **LLM** — split providers via OpenAI-compatible APIs: a reasoning **Professor** on OpenRouter (Qwen) and a fast **Student** on Grok (xAI), each with a graceful stub fallback
- **Auth** — HTTP Basic for the Conductor; JWT for tenant agents (with an MFA verify step)
- **Hosting** — Replit Deployments, custom domain `textitie.com`, shared reverse proxy routes by path

---

## Repository layout

```text
artifacts/
  api-server/        Express API — every /api/* route, the Twilio webhook, the Student pipeline
  user-app/          Tenant-facing React app (Textitie brand)
  eng-architect/     Admin Conductor React app (SAMA Control Plane)
  mockup-sandbox/    Component preview server for design iteration
lib/
  api-spec/          OpenAPI source of truth + codegen entry
  api-zod/           Generated Zod schemas
  api-client-react/  Generated React Query hooks
  ai-student/        Student role — prompt assembly + structured draft parsing
  db/                Drizzle schema + tenant-db helpers
scripts/             Operational scripts (provisioning, backfills)
John/                Operator notes, runbooks, backups, onboarding docs
```

---

## Local development

This is a Replit-hosted project. Workflows are managed by the Replit runtime; do **not** run `pnpm dev` at the repo root.

Run a single service:

```bash
pnpm --filter @workspace/api-server      run dev
pnpm --filter @workspace/user-app        run dev
pnpm --filter @workspace/eng-architect   run dev
pnpm --filter @workspace/mockup-sandbox  run dev
```

Regenerate the API client/schemas after editing the OpenAPI spec:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Typecheck everything:

```bash
pnpm run typecheck
```

Push a schema change to the dev database (then re-publish for prod):

```bash
pnpm --filter @workspace/db run push-force
```

---

## Routes

### User app (`textitie.com`)

**Public**

| Path | Page | Description |
|---|---|---|
| `/` | `Landing.tsx` | Marketing landing page |
| `/login` | `Login.tsx` | Tenant agent login (phase 1) + A2P 10DLC consent disclosure |
| `/verify` | `Verify.tsx` | MFA code verification (phase 2) |
| `/signup`, `/signup/trial` | `Signup.tsx` | Tenant registration / free-trial start |
| `/privacy` | `Privacy.tsx` | Privacy policy |
| `/terms` | `Terms.tsx` | Terms of service |

**Auth-gated (agent app shell)**

| Path | Page | Description |
|---|---|---|
| `/inbox` | `Inbox.tsx` | Real-time two-panel SMS inbox — claim/transfer/resolve, whispers, dispositions |
| `/contacts` | `Contacts.tsx` | Contacts + tagging + history; "Blocked" view with suppressed-inbound stats |
| `/settings` | `Settings.tsx` | Org settings, integrations, surveys, and the **AI Auto-Reply** (engagement mode) card |
| `/billing` | `Billing.tsx` | Usage, plan, Stripe checkout, itemized phone-number charges |
| `/automations` | `Automations.tsx` | Keyword replies, follow-ups, auto-resolve, welcome, opt-out + shortcuts |
| `/campaigns` | `Campaigns.tsx` | Bulk SMS campaigns — segmentation, scheduling, attribution |
| `/analytics` | `Analytics.tsx` | KPI dashboards (per agent / department) with CSV export |
| `/knowledge` | `Knowledge.tsx` | Tenant-facing knowledge-base editor (legacy KB fallback) |
| `/profile` | `Profile.tsx` | User profile + password management |

**Onboarding** (auth-gated, nested under `/onboarding`)

`/onboarding/profile` · `/organization` · `/agents` · `/departments` (TextLine-style integration chooser) · `/integrations` · `/security` · `/billing` · `/billing/payments` · `/credits` · `/plans`

### Admin Conductor (`textitie.com/admin/`)

| Path | Page | Description |
|---|---|---|
| `/` | `Dashboard.tsx` | Platform health + tenant stats |
| `/tenants` | `Tenants.tsx` | Master list of all tenants |
| `/tenants/:id` | `TenantDetail.tsx` | Tenant config, users, carrier-billing controls, surcharge waiver |
| `/tenants/:id/professor` | `Professor.tsx` | **Professor chat UI** for knowledge curation |
| `/injections` | `Injections.tsx` | System message-injection log |
| `/webhooks` | `Webhooks.tsx` | Inbound + delivery-status webhook log |
| `/compliance` | `Compliance.tsx` | TCPA / 10DLC compliance + opt-out registry |
| `/tiers` | `Tiers.tsx` | Pricing tier + feature-flag configuration |
| `/profile` | `Profile.tsx` | Admin profile settings |

### API surface (`/api`)

All routes are mounted under `/api` on a single Express router (`artifacts/api-server/src/routes/index.ts`). Auth falls into three buckets:

**Public / webhook**
`health` · `tenant-auth` (login + MFA) · Twilio `webhooks` (inbound SMS + delivery status, signature-validated) · public survey responses (`/s/:token`)

**Conductor — HTTP Basic auth**
`auth` (admin login) · `tenants` · `injections` · `stats` · `tiers` · `phone-provisioning` · Professor/Classroom curation under `knowledge`

**Tenant-scoped — JWT (`requireTenantAuth`)**
`conversations` · `contacts` · `campaigns` · `automations` · `shortcuts` · `analytics` · `dispositions` · `reminders` · `billing` · `integrations` · `tenant-settings` · `surveys` · `opt-ins` · `departments` · `agents` · `phone-numbers` · `audit-logs` · `events` · tenant knowledge upload

---

## LLM knowledge pipeline

A per-tenant knowledge flow turns raw documents and operator conversations into grounded SMS replies:

```
Knowledge Base ──▶ Library ──▶ Professor ──▶ Classroom ──▶ Student
 (raw docs)      (chunked    (operator     (published    (inbound
                  + indexed)  curation)     versioned     drafting)
                                            facts)
```

### Models & fallback

| Role | Provider / model (default) | Override env | Purpose |
|---|---|---|---|
| **Professor** | OpenRouter (Qwen) `qwen/qwen3-max` — a fast non-thinking tier | `SAMA_PROFESSOR_MODEL` | Fact extraction, Librarian adjudication, live escalation, heavy reasoning |
| **Student** | Grok (xAI) `grok-4.20-0309-non-reasoning` | `SAMA_STUDENT_MODEL` | Fast, cheap inbound reply drafting |

The **Professor** reaches OpenRouter through the **Replit AI Integrations proxy** (no key of ours, billed to Replit credits; env `AI_INTEGRATIONS_OPENROUTER_BASE_URL` + `_API_KEY`). The **Student** reaches xAI through the `openai` SDK pointed at `https://api.x.ai/v1` (key in the `GROK_KEYS` secret). Both clients live in `artifacts/api-server/src/lib/grokClient.ts`. **Each role degrades to a stub when its own provider is unconfigured** so the inbound SMS pipeline never breaks.

### 1) Library — ingestion + indexing

Per-tenant documents are added by **file upload, URL fetch (SSRF-guarded), or pasted text**, chunked, and indexed for **Postgres full-text retrieval** (`tsvector` + GIN — no vectors). PDF text is extracted with `pdfjs-dist`. (`artifacts/api-server/src/lib/knowledge.ts`; schema in `lib/db/src/schema/knowledge.ts`.)

### 2) Professor — operator curation

The Conductor chats a per-tenant Professor at `/admin/tenants/:id/professor`:

- **Streaming chat** over SSE (POST + `text/event-stream`) with a non-streaming fallback.
- Curation produces **absorbed facts** (default status `draft`) that the Conductor **accepts (`published`) or rejects**. Only published facts are eligible for the Classroom.
- Facts come from **two sources**: (1) attached Library sources, and (2) the **Professor's own chat answers** — each assistant message has an **"Absorb this answer"** action that runs the same extraction over the answer text. This is the bridge that lets knowledge the Professor brings *in conversation* (not just attached documents) reach the Classroom. The absorb action is **idempotent per message** and concurrency-safe (advisory-lock guarded).
- Each fact is **classified into a fixed taxonomy** — `pricing | compliance | features | technical_setup | general` — with app-level validation and a `general` fallback (no DB enum constraint, by design). The Conductor can correct a fact's category in the UI.
- Guardrails: max **5 active sessions** before a Push to Classroom (or archive) is required, plus a token-budgeted **"10M memory" meter**.

### 3) Classroom & the Librarian (dedup + conflict)

"Push to Classroom" snapshots the accepted facts into a new **versioned Classroom**. Before snapshotting, the **Librarian** (`artifacts/api-server/src/lib/librarian.ts`) runs inside the push transaction:

- Cheap near-duplicate detection via `pg_trgm` similarity, then **Professor (Qwen) adjudication** on candidate pairs.
- **Duplicates / refinements are auto-merged silently.**
- **Contradictions are flagged as `conflict`, never silently merged** — especially for `pricing` and `compliance` — and surfaced for Conductor resolution.

Facts are stored with their `category` (B-tree indexed on `(tenant_id, category)`) so retrieval can scope by topic.

### 4) Student — inbound drafting

A lightweight Student runs on every inbound SMS (`artifacts/api-server/src/routes/webhooks.ts`; prompt + parsing in `lib/ai-student/src/index.ts`):

- Retrieves the published Classroom via full-text search (`retrieveClassroomFacts`).
- **Category-scoped retrieval**: a cheap synchronous keyword classifier (`classifyQueryCategory`, no LLM) **boosts** the inbound message's likely category in the ranking — a boost, not a gate, so every full-text match stays eligible and a misclassification can only reshuffle ranking.
- Emits a **structured draft** (`SUMMARY` / `DRAFT REPLY` / `KB MATCH` / `CONFIDENCE`, parsed by `parseStudentSections`) carrying `draftReply`, `kbMatched`, `confidence`, and `groundedInClassroom` (true only when curated-Classroom retrieval was non-empty).
- The Student runs **off the inbound 200 response path**, inside a durable fire-and-forget pipeline that executes *after* the automation engine (only when no automation/opt-out already handled the message), so it never blocks the webhook ack and never replies over an automation.
- Stub-on-failure keeps the pipeline alive even if the model errors.

**Live escalation (the self-learning loop).** When the Student drafts a reply but can't ground it in the Classroom (`kbMatched` is false), the inbound is written to a durable per-conversation FIFO queue (`conversation_inbound_ai_stages`) and a background worker escalates to the **Professor** — off the inbound 200 path. The Professor answers from the tenant Library + its own expertise and returns strict JSON (a customer reply, a confidence, 2–3 atomic categorized candidate facts, and follow-up questions). The flow is **injection-safe**: the customer's SMS is treated as **query-only and never persisted as truth** — two deterministic guards (`screenEscalatedFacts`) drop any candidate fact that merely echoes the customer or isn't actually supported by the retrieved Library. In **Auto-Pilot**, a dedicated fail-closed gate (`evaluateProfessorEscalationSend`) decides whether to auto-send; on a clean autonomous send the screened facts are persisted as **published Classroom truth** (under the same `CLASSROOM_PUSH_LOCK` advisory lock as human pushes), so the system never escalates that question again. **Co-Pilot** drafts/whispers the answer (no learning); **Manual** skips escalation. (`professorEscalate`, `screenEscalatedFacts`, `persistEscalatedFacts` in `artifacts/api-server/src/lib/knowledge.ts`.)

### 5) Engagement mode & the auto-send gate

Delivery is governed by **three canonical engagement modes** — `manual | copilot | autopilot` (DB default **`copilot`**) — set as a per-tenant default (`tenants.engagementMode`) with an optional **per-conversation override** (`conversations.engagementModeOverride`; `null` inherits the tenant default). The effective mode is `override ?? tenant` (`resolveEffectiveEngagementMode`). Legacy aliases are folded on write (`assisted`→`copilot`, `gated_auto`→`autopilot`); any other unrecognized value is rejected on write and falls back to `copilot` on read — no data migration. The canonical list + normalization live in `artifacts/api-server/src/lib/engagementPolicy.ts`.

- **Manual** (🔵) — AI fully off: no Student draft, no auto-send, no learning. An inbound clears any pending AI state.
- **Co-Pilot** (🟡) — the Student drafts (and may consult the Professor *just to draft*); the draft is saved to `conversation_ai_states` (status `drafted`) and pre-filled into the inbox composer for a human to edit and send. **Co-Pilot never learns.**
- **Auto-Pilot** (🟢) — the Student drafts, then the **fail-closed** gate `evaluateAutoSend` runs. **Pass** → the reply is sent **verbatim** and the facts are learned. **Refuse, or the model fails** → **Blue handback for that one message** (AI state `refused`/`failed` + a reason chip in the inbox), **no learning**; the conversation returns to green once a human handles it. A human can step in at any time.

The auto-send gate (`artifacts/api-server/src/lib/engagementPolicy.ts`) passes only when **every** condition holds: mode is `autopilot`, draft ready, grounded in Classroom, `confidence=high`, KB matched, inbound intent **not** in `{pricing, compliance, technical_setup}`, grounding facts all in `{general, features}`, **no unresolved conflict**, and outbound compliance OK.

**Learning rule:** facts are persisted to the Library/Classroom **if and only if** the AI reply was **sent autonomously and unedited** (a confirmed Auto-Pilot send). Any human touch — Co-Pilot, a handback, or a step-in — **never learns**.

Safety properties:

- **Compliance is re-checked at send time** (opt-out, quiet hours, frequency caps) inside the shared `sendConversationReply`, not just pre-checked.
- **Idempotent**: auto-send claims the inbound carrier `MessageSid` in `ai_auto_replies` (unique `(tenant_id, inbound_sid)`) before sending, so a webhook retry can never double-send. Only a completed send is terminal; a failed send releases the claim so a retry can re-attempt.
- On auto-send the reply is mirrored to Chatwoot as a public outgoing message; otherwise a private whisper is posted.

Tenants toggle the mode from the **Settings** page's **"AI Auto-Reply"** card (admin/owner only).

---

## Key features

- **Multi-tenant inbox** — claim / transfer / unassign / resolve, whispers (internal notes), dispositions, contacts + tagging, conversation search & filtering, per-user conversation reminders.
- **Campaigns** — bulk SMS with audience segmentation, scheduling, variable injection, credit checks, segment-aware billing, Twilio delivery webhooks, and last-touch attribution for responses/opt-outs.
- **Automations & shortcuts** — keyword replies, follow-ups, auto-resolve, welcome messages, opt-out handling, and reusable message templates.
- **Analytics** — total/open/closed conversations, response times, message counts, per-agent/department metrics, CSV export.
- **CSAT surveys** — one-tap SMS surveys auto-sent after conversation closure, a public response page, and dedicated analytics.
- **Audit log** — every action indexed by entity, action, and timestamp.

## Billing & phone numbers

- **Hybrid Stripe billing** — real Stripe Checkout is wired for new subscriptions (`POST /billing/checkout` against live prices); plan changes, cancellation, metering, and the free trial run through a credit-model stub that behaves identically for stub or real `sub_*` subscriptions.
- **Phone numbers** — purchasing is unlimited (plan tiers only *bundle* included numbers, never cap). **Local** numbers incur a `$15/mo carrier fee + $10/mo unregistered surcharge` (surcharge waivable per-tenant by the Conductor); **toll-free** numbers are `$0` recurring. Number type is derived from the E.164 number and self-healed on boot.
- **Carrier billing** — a DB-derived snapshot is the single source of truth for the itemized "Phone Number Charges" card and is idempotently reconciled onto real Stripe subscriptions (with a manual Conductor reconcile path as recovery).
- **Sold-out area-code recovery** — a zero-result local search is framed as carrier stock-out and offers nearby area codes re-verified against live Twilio stock.

## Compliance

- **TCPA** — opt-ins, double opt-in, tenant quiet hours, frequency caps; outbound checks block violating sends.
- **10DLC** — Twilio Trust Hub integration; A2P consent disclosure rendered on Login + Signup (Error 30491 review).
- **Contact block (two-way)** — a blocked number is rejected on outbound and **dropped on inbound** (no agent forward, no AI whisper, no conversation create) — with an `inbound.blocked` audit trail. The `/contacts` "Blocked" view shows suppressed-inbound stats and one-click unblock.
- **HIPAA** — tier-flagged eligibility, BAA acknowledgment, PHI redaction in logs.

---

## External dependencies

- **Twilio** — outbound SMS, inbound routing, status callbacks, 10DLC compliance, number provisioning.
- **xAI (Grok)** — OpenAI-compatible LLM API (`https://api.x.ai/v1`, `GROK_KEYS` secret) powering the **Student** (`grok-4.20-0309-non-reasoning`) inbound-drafting role.
- **OpenRouter (Qwen)** — the **Professor** role (`qwen/qwen3-max`; curation, Librarian adjudication, and live escalation), via the Replit AI Integrations proxy (`AI_INTEGRATIONS_OPENROUTER_*`).
- **Stripe** — subscription checkout, billing, and webhook sync.
- **Chatwoot** — sovereign conversation bridging; private-note (whisper) and public-message mirroring.
- **HubSpot** — CRM contact/activity sync (stub-first connector with a queue + worker).
- **PostgreSQL** — primary datastore (Drizzle ORM, full-text retrieval).
- **pdfjs-dist** — PDF text extraction for the knowledge Library.

---

## Documentation

| Doc | Purpose |
|---|---|
| [`replit.md`](replit.md) | Architecture overview, Stage 4 status, user preferences |
| [`John/Run_Book.md`](John/Run_Book.md) | Twilio go-live runbook, secrets, diagnostics (operational) |
| [`John/Hardening.md`](John/Hardening.md) | Production-hardening backlog (living) |
| [`John/Database_URL_work.md`](John/Database_URL_work.md) | Dev/prod database split task |
| [`John/architecture.doc.md`](John/architecture.doc.md) | Append-only durable architecture lessons |
| [`John/Archive/`](John/Archive/) | Superseded historical docs (phase plans, Stage 4, retired gate ledger) |

> The "Scaffolding" gate-ledger experiment (`Gate_Build.md` + `Regeneration.md`) was retired and archived to `John/Archive/`. `replit.md` is the single source of truth for build status.

---

## Deployment

Production deploys are handled by Replit. The published app runs at https://textitie.com over HTTPS through the Replit reverse proxy, which routes `/api/*` to the API server, `/admin/*` to the Conductor UI, and `/` to the user app. Production schema is migrated automatically by the Publish flow (dev → prod schema diff) — there is no custom migration step.

For the Twilio go-live procedure (secrets, webhook URLs, smoke test), see [`John/Run_Book.md`](John/Run_Book.md).

---

© Textitie · All rights reserved
