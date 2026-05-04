# Project SAMA — Control Plane (Gate 5)

Multi-tenant control plane for SAMA (Simple but Advanced Messaging Alternative). Master Conductor oversees tenants, fires injections into the SAMA pipe, watches inbound webhooks. Live integrations: Twilio direct sender, Chatwoot sovereign bridge (textitie.com), AI Student Whisperer (gpt-4o-mini).

## Architecture

- **Monorepo**: pnpm workspace.
- **Contract-first**: `lib/api-spec/openapi.yaml` → orval codegen → `@workspace/api-client-react` (React Query hooks) + `@workspace/api-zod` (zod schemas).
- **DB**: Drizzle (Postgres) — schemas in `lib/db/src/schema/{tenants,tiers,injections,webhookEvents}.ts`.
- **API**: `artifacts/api-server` (Express, port 8080, mounted at `/api`).
- **UI**: `artifacts/eng-architect` (React + Vite + wouter + shadcn, mounted at `/`).

## API surface (all under `/api`)

- `GET /healthz`
- `GET /tiers` · `GET /tenants` · `POST /tenants` · `GET /tenants/:id` · `PATCH /tenants/:id`
- `POST /tenants/:id/knowledge-upload` — multipart file upload (PDF/TXT/MD/CSV, max 5MB); extracts text and appends to tenant KB.
- `POST /inject` — Conductor-triggered message; STUBBED unless `N8N_WEBHOOK_URL` is set.
- `GET /injections?limit=`
- `POST /webhooks/:source` (twilio | chatwoot | n8n) — records arbitrary JSON payload.
- `GET /webhook-events?limit=`
- `GET /stats` — tenantCount, injectionCount, webhookEventCount, injectionsLast24h, tenantsByRegion, tenantsByTier.
- `GET /compliance` — 10DLC compliance report from Twilio Trust Hub APIs (brand, bundle, customer profile, tenant numbers).

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
- Omits `WWW-Authenticate` header for AJAX requests (prevents browser native dialog hijacking fetch calls).

## Frontend Login Gate (Gate 5)

- `artifacts/eng-architect/src/pages/Login.tsx` — login form validates credentials against `GET /api/tenants`.
- `artifacts/eng-architect/src/lib/auth.ts` — stores Basic Auth header in `sessionStorage`; injects via `setAuthHeaderGetter` from `@workspace/api-client-react`.
- Auto-logout on 401: `QueryCache`/`MutationCache` `onError` clears stored auth and redirects to login.

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

`/` Login gate → Dashboard · `/tenants` · `/tenants/:id` (KB upload button) · `/injections` (with inline composer) · `/webhooks` (filter by source) · `/compliance` (10DLC status cards + number inventory) · `/tiers`. Persistent left sidebar with SAMA wordmark + "CONDUCTOR MODE" indicator. Global "Inject Message" button in the header opens the composer dialog from anywhere.

## Chatwoot Auto-Provisioning (Gate 5)

`POST /tenants` auto-provisions a Chatwoot API inbox on the sovereign node (textitie.com) for each new tenant. `provisionChatwootInbox()` in `chatwoot.ts` creates the inbox and returns the real `inbox_id` + `account_id`. STUBBED when Chatwoot creds unset.

## 10DLC Compliance Monitor (Gate 5)

`GET /api/compliance` queries Twilio Trust Hub APIs (Brand Registration, A2P Bundle, Customer Profile) using env vars `Brand_registration_SID`, `Trust_Hub_A2P_Bundle_SID`, `Connected_Customer_Profile_SID`. Returns real-time registration statuses + tenant number inventory.

## Knowledge Base File Upload (Gate 5)

`POST /api/tenants/:id/knowledge-upload` accepts PDF/TXT/MD/CSV via multipart upload (max 5MB). PDFs extracted via `pdfjs-dist`; text files read as UTF-8. Extracted content appended to tenant `knowledge_base` column with separator.

## Required secrets

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SAMA_FROM_NUMBER` — live Twilio sender.
- `CONDUCTOR_PASSWORD` (and optionally `CONDUCTOR_USERNAME`) — enforce admin auth.
- `N8N_WEBHOOK_URL` (optional) — downstream notification fan-out.
- `CHATWOOT_BASE_URL`, `CHATWOOT_API_ACCESS_TOKEN` — activate live Chatwoot bridge (Gate 3/4).
- `OPENAI_API_KEY` — activate the AI Student Whisperer (Gate 4). Optional `SAMA_STUDENT_MODEL` to override the default `gpt-4o-mini`.
- `Brand_registration_SID`, `Trust_Hub_A2P_Bundle_SID`, `Connected_Customer_Profile_SID` — 10DLC compliance monitor (Gate 5).
