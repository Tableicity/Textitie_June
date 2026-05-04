# Phase 9.1 — Integrations & Compliance (Partial Scope)

## In Scope This Session (4 of 6 workstreams)

### 1. Audit Logs
Every tenant write is recorded with actor, IP, user-agent, before/after diff, and timestamp.

- **Schema**: `audit_logs` table (`id`, `tenant_id`, `actor_user_id`, `actor_email`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `ip`, `user_agent`, `created_at`).
- **Helper**: `recordAudit(req, { action, entityType, entityId, before, after })` callable from any tenant route.
- **Wired into**: conversations PATCH, dispositions CRUD, contacts CRUD, reminders create/dismiss/delete, agents role/skills changes, settings changes.
- **UI**: Tenant **Settings → Audit Log** tab with paginated list + entity/action filter. Admin sees a global view via the Control Plane.
- **Endpoint**: `GET /audit-logs?entityType=&entityId=&actorUserId=&from=&to=&limit=&offset=` (tenant-scoped).

### 2. TCPA Compliance Enhancements
Builds on existing `opt_outs` (STOP/UNSUBSCRIBE handling).

- **Quiet hours**: per-tenant `quiet_hours_start`, `quiet_hours_end`, `quiet_hours_tz` columns on `tenants`. Outbound sends + campaign dispatch blocked during quiet hours; campaigns auto-defer.
- **Frequency cap**: per-tenant `frequency_cap_per_day` (default 5). Outbound to a phone over the limit in 24h is rejected with a clear error.
- **Double opt-in tracking**: `opt_ins` table (`tenant_id`, `phone`, `source` enum [`web_form`,`keyword`,`agent_collected`,`imported`], `consented_at`, `ip`, `user_agent`, `evidence_url`). Tenant flag `require_double_opt_in` blocks outbound to phones with no recorded consent.
- **UI**: Settings → **Compliance** tab with quiet-hours editor, frequency-cap slider, double-opt-in toggle, and a search-by-phone consent lookup.

### 3. HubSpot Connector (Stub-First)
The internal contract is real and production-ready; only the outbound HTTP calls hit a fake provider.

- **Schema**:
  - `integrations` (`id`, `tenant_id`, `provider` ['hubspot'|'salesforce'|'slack'], `status` ['disconnected'|'connected'|'error'], `display_name`, `config_json`, `settings_json`, `connected_at`, `last_sync_at`, `last_error`).
  - `crm_sync_queue` (`id`, `tenant_id`, `provider`, `entity_type` ['contact'|'conversation'], `entity_id`, `op` ['upsert'|'delete'|'log_activity'], `payload_json`, `status` ['pending'|'in_flight'|'done'|'failed'], `attempts`, `last_error`, `next_attempt_at`, `created_at`, `updated_at`).
- **Stub client**: `StubHubSpotClient` simulates contact upsert + engagement creation, returns synthetic external IDs (`stub_hs_*`), records every call in an in-memory log surfaced via `GET /integrations/hubspot/sim-log` for demo trust.
- **Worker**: `processCrmSyncQueue()` invoked from `timerEngine` every cycle; pulls pending/retry rows in tenant order, calls the stub, records success/failure with exponential backoff (max 5 attempts).
- **Triggers**: Contact create/update enqueues `upsert`; conversation resolve enqueues `log_activity` with disposition + resolution note.
- **UI**: Settings → **Integrations** tab with HubSpot card (Connect/Disconnect, status pill, last-sync timestamp, recent sync activity, sim-log preview).
- **Swap-ready seam**: `lib/integrations/hubspot/client.ts` exports `HubSpotClient` interface; `StubHubSpotClient` is the only implementation today, real OAuth client lands in a future session without touching routes/worker.

### 4. HIPAA Plan Flag
Posture flag, not a full HIPAA certification — surfaces the right behavior across the app.

- **Schema additions on `tenants`**: `hipaa_enabled` boolean, `baa_acknowledged_at` timestamp, `baa_acknowledged_by` user id.
- **Tier flag**: extend tier `features_json` with `hipaa_eligible` boolean; HIPAA cannot be enabled on a non-eligible tier.
- **PHI redaction**: server logger transformer redacts E.164 phone numbers and message bodies in log output when the tenant has `hipaa_enabled=true` (best-effort; structured fields are tagged so the redactor knows what to scrub).
- **Forced posture**: when HIPAA is on — audit logs cannot be disabled, tenant session TTL drops to 8h (was 30d), webhook payloads omit message bodies (URL only).
- **UI**: Settings → **Compliance → HIPAA** subsection with eligibility check, BAA acknowledgment modal (records `baa_acknowledged_at` + actor), and a status banner shown app-wide when enabled.

## Deferred to a Later Phase 9.x Session

The following 5 workstreams need dedicated focus and external configuration. Plan below so we can pick them up cleanly.

### Slack connector
- Replit `slack` integration via OAuth.
- Tenant maps inbound conversations to a Slack channel; Slack thread mirrors the SAMA thread; agent replies from Slack via slash command or thread reply.
- Reuses the `integrations` + `crm_sync_queue` machinery already shipped here — only need a real `SlackClient` implementation and a thread-mapping table.

### Salesforce connector
- Replit `salesforce` integration via OAuth (Connected App).
- Same `integrations` row pattern; `SalesforceClient` upserts Contacts/Leads and writes Tasks for resolved conversations.
- Field mapping UI (SAMA tag → SF Lead Source, etc.) is the main UX cost.

### IP whitelisting
- Per-tenant `ip_allowlist` (CIDR list) on `tenants`.
- Enforced in `requireTenantAuth` middleware (and login route).
- UI: Settings → Compliance → IP Allowlist with current-IP helper and "lock yourself out" guard.

### Developer API & webhooks
- `api_tokens` table (tenant_id, name, hashed_token, scopes, last_used_at, revoked_at).
- New `/api/v1/*` surface that mirrors a curated subset of tenant routes, authed by the API token (separate middleware from JWT).
- `webhook_endpoints` table + dispatcher with HMAC signing, retries, delivery log; supported events: `message.created`, `message.delivered`, `conversation.assigned`, `conversation.resolved`, `contact.created`, `optout.received`.
- Settings → Developers tab (tokens, endpoints, recent deliveries).

### SAML/SSO
- Use `passport-saml` or `@node-saml/node-saml`.
- New `tenant_saml_configs` table (idp_metadata_url, idp_cert, sp_entity_id, sp_acs_url, attribute mappings).
- Dual login: tenant chooses password vs SAML at the email-collection step (or auto-redirect by email domain).
- JIT user provisioning + role mapping from SAML attributes.
- Largest single workstream — budget a full session.

## Execution Order (this session)
1. Schemas (audit_logs, opt_ins, integrations, crm_sync_queue) + tenants column adds → `db push`.
2. OpenAPI additions in one pass → codegen.
3. Backend: audit helper + wiring, TCPA enforcement in send paths, integrations routes + stub client + worker, HIPAA flag + redactor + posture enforcement.
4. Frontend: Settings tabs (Audit Log, Compliance, Integrations) + HIPAA banner.
5. Verify: typecheck, e2e curl, architect review, replit.md update.
