# Project SAMA — Control Plane (Gate 4)

Multi-tenant control plane for SAMA (Simple but Advanced Messaging Alternative). Master Conductor oversees tenants, fires injections into the SAMA pipe, watches inbound webhooks. Twilio / Chatwoot / n8n are stubbed at this gate — no live credentials.

## Architecture

- **Monorepo**: pnpm workspace.
- **Contract-first**: `lib/api-spec/openapi.yaml` → orval codegen → `@workspace/api-client-react` (React Query hooks) + `@workspace/api-zod` (zod schemas).
- **DB**: Drizzle (Postgres) — schemas in `lib/db/src/schema/{tenants,tiers,injections,webhookEvents}.ts`.
- **API**: `artifacts/api-server` (Express, port 8080, mounted at `/api`).
- **UI**: `artifacts/eng-architect` (React + Vite + wouter + shadcn, mounted at `/`).

## API surface (all under `/api`)

- `GET /healthz`
- `GET /tiers` · `GET /tenants` · `POST /tenants` · `GET /tenants/:id`
- `POST /inject` — Conductor-triggered message; STUBBED unless `N8N_WEBHOOK_URL` is set.
- `GET /injections?limit=`
- `POST /webhooks/:source` (twilio | chatwoot | n8n) — records arbitrary JSON payload.
- `GET /webhook-events?limit=`
- `GET /stats` — tenantCount, injectionCount, webhookEventCount, injectionsLast24h, tenantsByRegion, tenantsByTier.

## Modular sender pipeline (Gate 2: Twilio direct)

`artifacts/api-server/src/lib/senders/` — pluggable engines behind one `MessageSender` interface so swapping Twilio↔Fonoster (Hetzner DE/EE) is a one-line change in the factory.

- `TwilioSender` — direct Twilio REST (`twilio` SDK). Active when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SAMA_FROM_NUMBER` are all set.
- `StubSender` — Gate-1 fallback. Active when creds missing or `SAMA_SENDER=stub`.
- Future: `FonosterSender` for the Hetzner self-hosted SIP node.

`dispatchInjection()` calls the active sender, then (if `N8N_WEBHOOK_URL` is set) fires a non-blocking notification to n8n with the send result. n8n is now downstream observer/orchestrator, not the transport.

## Conductor Auth (HTTP Basic)

`artifacts/api-server/src/middleware/conductorAuth.ts` gates `/api/*` with HTTP Basic Auth.
- Bypassed for `/api/healthz` and `/api/webhooks/*` (carriers can't send Basic Auth).
- Enforced when `CONDUCTOR_PASSWORD` is set; logs WARN and stays open if unset.
- Username: `CONDUCTOR_USERNAME` (default `conductor`).
- Constant-time password compare via `node:crypto.timingSafeEqual`.

## Multi-Tenant Intelligence (Gate 3)

`tenants` table extended with `phone_number` (E.164, dual-purpose: outbound `From` + inbound routing key), `chatwoot_account_id`, `chatwoot_inbox_id`.

- **Inbound Router** (`/api/webhooks/twilio`): matches `To` against `tenants.phone_number`. Match → POSTs to Chatwoot as `incoming` and annotates payload with `_sama:{routed,tenantSlug,chatwoot}`. No match → annotates `unassignedLead:true` and logs WARN.
- **Per-tenant From**: `dispatchInjection` takes the full `Tenant`; `TwilioSender` accepts `fromOverride` so each tenant sends from its own number.
- **Whisper** (forward path): if tenant has Chatwoot ids, posts a private note (`message_type=outgoing, private=true`) before the Twilio send.
- `lib/chatwoot.ts` — REST client (search/create contact → ensure conversation → post). STUBBED when `CHATWOOT_BASE_URL` / `CHATWOOT_API_ACCESS_TOKEN` unset.

## AI Student + Knowledge Base (Gate 4)

- `tenants.knowledge_base text` column. Editable from `/tenants/:id` via new `PATCH /api/tenants/:id` endpoint.
- `lib/ai-student/` — `studentWhisper({tenant, fromNumber, inboundBody})` calls OpenAI (`gpt-4o-mini` by default, override with `SAMA_STUDENT_MODEL`) with the tenant KB as RAG context. Returns SUMMARY / DRAFT REPLY / KB MATCH. STUBBED when `OPENAI_API_KEY` unset.
- Wired into the inbound router as **fire-and-forget** — webhook returns 201 immediately; the Whisper drafts and posts to the same Chatwoot conversation as a Private Note shortly after.

## Seed data

3 tiers (starter / growth / enterprise) and 3 tenants (acme→DE/starter, orbital→EE/growth, helvetia→DE/enterprise, sovereignToggle=true).

## UI pages

`/` Dashboard · `/tenants` · `/tenants/:id` · `/injections` (with inline composer) · `/webhooks` (filter by source) · `/tiers`. Persistent left sidebar with SAMA wordmark + "CONDUCTOR MODE" indicator. Global "Inject Message" button in the header opens the composer dialog from anywhere.

## Required secrets

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SAMA_FROM_NUMBER` — live Twilio sender.
- `CONDUCTOR_PASSWORD` (and optionally `CONDUCTOR_USERNAME`) — enforce admin auth.
- `N8N_WEBHOOK_URL` (optional) — downstream notification fan-out.
- `CHATWOOT_BASE_URL`, `CHATWOOT_API_ACCESS_TOKEN` — activate live Chatwoot bridge (Gate 3/4).
- `OPENAI_API_KEY` — activate the AI Student Whisperer (Gate 4). Optional `SAMA_STUDENT_MODEL` to override the default `gpt-4o-mini`.
- Already present: `Brand_registration_SID`, `Trust_Hub_A2P_Bundle_SID`, `Connected_Customer_Profile_SID` (A2P registration; not yet referenced by code).
