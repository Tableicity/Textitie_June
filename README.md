# Textitie

> Two-way SMS for teams that actually answer.

**Live:** https://textitie.com
**Internal codename:** SAMA (Simple but Advanced Messaging Alternative)
**Status:** In production · awaiting first live Twilio number for end-to-end go-live

Textitie is a multi-tenant, compliance-first conversational SMS platform. Tenants get a Textline-style inbox; the platform operator gets a Master Conductor for tenant management, message injection, and webhook monitoring. **Halo AI** drafts response suggestions from tenant-uploaded knowledge so agents can answer faster without losing the human touch.

---

## Table of contents

- [Architecture at a glance](#architecture-at-a-glance)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Routes](#routes)
- [Status & Gate Table](#status--gate-table)
- [Key features](#key-features)
- [External dependencies](#external-dependencies)
- [Documentation](#documentation)
- [Deployment](#deployment)

---

## Architecture at a glance

- **Monorepo** — pnpm workspaces
- **Contract-first API** — OpenAPI (`lib/api-spec/openapi.yaml`) generates clients + Zod schemas
- **Database** — PostgreSQL via Drizzle ORM. All data in `public` schema with explicit `tenant_id` scoping. Schema-per-tenant isolation (Stage 4) is intentionally deferred — see `replit.md`.
- **API server** — Express.js (`artifacts/api-server`)
- **User UI** — React + Vite + wouter + shadcn (`artifacts/user-app`) — public landing at `/`, agent inbox at `/inbox`
- **Admin UI** — React + Vite + wouter + shadcn (`artifacts/eng-architect`) — served at `/admin/`
- **Auth** — HTTP Basic for the Conductor; JWT for tenant agents
- **Hosting** — Replit Deployments, custom domain `textitie.com`

---

## Repository layout

```text
artifacts/
  api-server/      Express API (all /api/* routes)
  user-app/        Tenant-facing React app (Textitie brand)
  eng-architect/   Admin Conductor React app (SAMA brand)
  mockup-sandbox/  Component preview server for design iteration
lib/
  api-spec/        OpenAPI source of truth + codegen entry
  api-zod/         Generated Zod schemas
  api-client-react/ Generated React Query hooks
  db/              Drizzle schema + tenant-db helpers
scripts/           Operational scripts (provisioning, backfills)
John/              Operator notes, runbooks, backups, threat model
```

---

## Local development

This is a Replit-hosted project. Workflows are managed by the Replit runtime; do **not** run `pnpm dev` at the repo root.

To start a service locally:

```bash
pnpm --filter @workspace/api-server      run dev
pnpm --filter @workspace/user-app        run dev
pnpm --filter @workspace/eng-architect   run dev
pnpm --filter @workspace/mockup-sandbox  run dev
```

Codegen after changing the OpenAPI spec:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Typecheck everything:

```bash
pnpm run typecheck
```

---

## Routes

### User-app (`textitie.com`)
**Public:** `/`, `/login`, `/verify`, `/signup`, `/signup/trial`, `/privacy`, `/terms`
**Auth-gated:** `/inbox`, `/contacts`, `/settings`, `/billing`, `/automations`, `/campaigns`, `/analytics`, `/knowledge`

### Admin Conductor (`textitie.com/admin/`)
Tenant management · phone-number provisioning · message injection · webhook monitoring · 10DLC compliance dashboard

---

## Status & Gate Table

A full Gate Table (✅ shipped · 🟡 stubbed · 🔴 not built · ⏸️ deferred · 🔵 in progress) lives in [`John/Run_Book.md`](John/Run_Book.md), along with the Twilio go-live runbook and troubleshooting guide. Brief snapshot:

- ✅ Foundation, core messaging, agent inbox, compliance (TCPA + 10DLC), campaigns, automations, analytics, surveys, audit log
- 🟡 Stripe (stubbed), HubSpot connector (stub-first), Chatwoot bridging (code-ready, needs prod instance)
- 🔵 **Twilio phone number provisioning** — current blocker
- 🔴 Halo AI inbox button is a placeholder; Halo Library curation UI; production OpenAI key verification
- ⏸️ Stage 4 schema-per-tenant isolation

---

## Key features

- **Multi-tenant inbox** with claim / transfer / unassign / resolve, whispers (internal notes), dispositions, contacts + tagging, conversation search, reminders
- **Halo AI Whisperer** — RAG drafts from tenant-uploaded PDF/TXT/MD/CSV (≤5 MB)
- **Campaigns** — bulk SMS, segmentation, scheduling, variable injection, segment-aware billing, last-touch attribution
- **Automations** — keyword reply, follow-ups, auto-resolve, welcome messages, opt-out handling, message shortcuts
- **Analytics dashboard** with CSV export
- **CSAT surveys** — one-tap SMS surveys after conversation closure
- **TCPA compliance** — opt-ins, double opt-in, quiet hours, frequency caps, opt-out gate on outbound
- **10DLC** — Twilio Trust Hub integration; A2P consent disclosure on Login + Signup
- **HIPAA** — tier-flagged eligibility, BAA acknowledgment, PHI redaction in logs
- **Stripe billing** — plans, per-message credits, metering, free trial (stubbed pending live keys)
- **Audit log** — every action indexed by entity, action, timestamp

---

## External dependencies

- **Twilio** — outbound SMS, inbound routing, status callbacks, 10DLC compliance
- **Chatwoot** — sovereign conversation bridging, private-note posting for Halo drafts
- **OpenAI** — `gpt-4o-mini` for Halo Whisperer
- **PostgreSQL** — primary datastore
- **pdfjs-dist** — knowledge base PDF text extraction

---

## Documentation

| Doc | Purpose |
|---|---|
| [`replit.md`](replit.md) | Architecture overview, Stage 4 status, user preferences |
| [`John/Run_Book.md`](John/Run_Book.md) | Gate Table, Twilio go-live runbook, troubleshooting |
| [`John/Hardening.md`](John/Hardening.md) | Security hardening notes |
| [`John/MultiTenant.md`](John/MultiTenant.md) | Multi-tenancy design notes |
| [`John/architecture.doc.md`](John/architecture.doc.md) | Architecture reference |

---

## Deployment

Production deploys are handled by Replit. The published app runs at https://textitie.com and is automatically served over HTTPS through the Replit reverse proxy. The shared proxy routes `/api/*` to the API server, `/admin/*` to the Conductor UI, and `/` to the user app.

For the Twilio go-live procedure (secrets, webhook URLs, smoke-test script), see [`John/Run_Book.md`](John/Run_Book.md) §3.

---

© Textitie · All rights reserved
