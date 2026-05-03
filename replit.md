# Project SAMA — Control Plane (Gate 1)

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

## Gate-1 stub behavior

`artifacts/api-server/src/lib/sama.ts::forwardInjectionToN8n`:
- If `N8N_WEBHOOK_URL` unset → injection logged with `status="stubbed"`, response `"Stubbed: N8N_WEBHOOK_URL not configured — Gate 1 plumbing only"`.
- If set → POSTs `{ to, body, metadata: { source, conductor_authorized, tenant_id } }`; status becomes `sent` or `failed` based on n8n response.

## Seed data

3 tiers (starter / growth / enterprise) and 3 tenants (acme→DE/starter, orbital→EE/growth, helvetia→DE/enterprise, sovereignToggle=true).

## UI pages

`/` Dashboard · `/tenants` · `/tenants/:id` · `/injections` (with inline composer) · `/webhooks` (filter by source) · `/tiers`. Persistent left sidebar with SAMA wordmark + "CONDUCTOR MODE" indicator. Global "Inject Message" button in the header opens the composer dialog from anywhere.

## Gate-2 wiring (next)

Set `N8N_WEBHOOK_URL` (and later `TWILIO_*`, `CHATWOOT_*`) as environment secrets — code already routes to live endpoints when present.
