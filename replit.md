# Project SAMA — Control Plane (Gate 5) + User Messaging (Gate 1)

Multi-tenant control plane for SAMA (Simple but Advanced Messaging Alternative). Master Conductor oversees tenants, fires injections into the SAMA pipe, watches inbound webhooks. Live integrations: Twilio direct sender, Chatwoot sovereign bridge (textitie.com), AI Student Whisperer (gpt-4o-mini).

## Architecture

- **Monorepo**: pnpm workspace.
- **Contract-first**: `lib/api-spec/openapi.yaml` → orval codegen → `@workspace/api-client-react` (React Query hooks) + `@workspace/api-zod` (zod schemas).
- **DB**: Drizzle (Postgres) — schemas in `lib/db/src/schema/{tenants,tiers,injections,webhookEvents,tenantUsers,conversations,messages,departments}.ts`.
- **API**: `artifacts/api-server` (Express, port 8080, mounted at `/api`).
- **Admin UI**: `artifacts/eng-architect` (React + Vite + wouter + shadcn, mounted at `/`).
- **User UI**: `artifacts/user-app` (React + Vite + wouter + shadcn, mounted at `/app`).

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
- Bypassed for `/api/healthz`, `/api/webhooks/*`, `/api/tenant-auth/*`, and `/api/conversations*` (tenant-scoped routes use their own auth).
- Bearer tokens with `scope: "tenant"` are explicitly rejected by conductorAuth to prevent tenant→admin privilege escalation.
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

`/` Login gate (email+password) → Dashboard · `/tenants` · `/tenants/:id` (KB upload button) · `/injections` (with inline composer) · `/webhooks` (filter by source) · `/compliance` (10DLC status cards + number inventory) · `/tiers` · `/profile` (user management). Persistent left sidebar with SAMA wordmark + "CONDUCTOR MODE" indicator. Bottom of sidebar: "User Management" link + "Sign Out" button. Global "Inject Message" button in the header opens the composer dialog from anywhere.

## Chatwoot Auto-Provisioning (Gate 5)

`POST /tenants` auto-provisions a Chatwoot API inbox on the sovereign node (textitie.com) for each new tenant. `provisionChatwootInbox()` in `chatwoot.ts` creates the inbox and returns the real `inbox_id` + `account_id`. STUBBED when Chatwoot creds unset.

## 10DLC Compliance Monitor (Gate 5)

`GET /api/compliance` queries Twilio Trust Hub APIs (Brand Registration, A2P Bundle, Customer Profile) using env vars `Brand_registration_SID`, `Trust_Hub_A2P_Bundle_SID`, `Connected_Customer_Profile_SID`. Returns real-time registration statuses + tenant number inventory.

## Knowledge Base File Upload (Gate 5)

`POST /api/tenants/:id/knowledge-upload` accepts PDF/TXT/MD/CSV via multipart upload (max 5MB). PDFs extracted via `pdfjs-dist`; text files read as UTF-8. Extracted content appended to tenant `knowledge_base` column with separator.

## Deployment

- **Production URL**: `https://textitie.replit.app`
- **Deploy target**: autoscale
- **Build**: Clean compile only (`pnpm --filter @workspace/api-server run build`). No database commands in the build step — those caused publish hangs.
- **Startup schema check**: `schemaCheck.ts` runs at server startup, queries `information_schema.tables` and logs an ERROR if any required table is missing. Non-blocking — server still starts, but the log makes it obvious what needs fixing.
- **Startup super user seed**: `seedSuperuser.ts` runs after schema check. Idempotent — skips if user already exists.
- **Schema sync (manual)**: Run `DATABASE_URL="<url>" pnpm --filter @workspace/db run push-force` from the shell before publishing if schema has changed.
- **External database**: The project uses an external PostgreSQL database via `DATABASE_URL` (not Replit's managed PostgreSQL). Currently a shared secret — same value in dev and production. See "DATABASE_URL Separation" below for recommended split.

## Users & Authentication

- `users` table: `lib/db/src/schema/users.ts` — id, email, password_hash (scrypt), role, created_at.
- Login: `POST /api/auth/login` validates email+password, returns HMAC-signed Bearer token (24h TTL, signed with SESSION_SECRET).
- Auth middleware accepts both Bearer tokens (UI) and Basic Auth (programmatic/API access).
- User management API: `GET /api/auth/users`, `POST /api/auth/users`, `PATCH /api/auth/users/:id/password`, `DELETE /api/auth/users/:id`.
- Frontend: `/profile` page — list users, create new users (email/password/role), reset passwords, delete users.
- Sidebar: "User Management" and "Sign Out" buttons pinned to the bottom of the left nav.
- Password hashed with Node.js `crypto.scrypt` (16-byte random salt + 64-byte key, stored as `salt:hash`).
- Super user seed reads from `SUPERUSER_EMAIL` + `SUPERUSER_PASSWORD` env vars. Skips silently if not set or if users table is missing.

## SAMA Messaging — User-Facing App (Gate 1)

`artifacts/user-app` — Textline-style messaging inbox for tenant customer agents. Mounted at `/app`.

### Tenant Auth
- `tenant_users` table: `lib/db/src/schema/tenantUsers.ts` — id, tenant_id (FK→tenants), email (unique), password_hash (scrypt), name, role (admin|agent|supervisor), active, status (online|offline|away), skills (text), languages (text), lastAssignedAt, created_at.
- `POST /api/tenant-auth/login` — email+password login, returns JWT with `scope: "tenant"` (24h TTL).
- `GET /api/tenant-auth/me` — returns current tenant user info from token.
- `requireTenantAuth` middleware (`artifacts/api-server/src/middleware/tenantAuth.ts`) validates tenant JWT and attaches `req.tenantUser`.
- Test credentials: `abc17@gmail.com` / `Whereisdad@1` (tenant_id=1, ACME Corp, admin role).

### Conversations & Messages
- `conversations` table: `lib/db/src/schema/conversations.ts` — tenant-scoped, with contactPhone, contactName, status (open/closed/snoozed), assignedUserId, assignedAt, lastMessageAt.
- `messages` table: same file — conversation_id (FK→conversations), direction (inbound/outbound), body, channel, externalId, createdAt.
- `conversation_events` table: `lib/db/src/schema/conversationEvents.ts` — audit trail for claims, transfers, unassigns. Fields: conversationId, eventType, actorId, targetId, note, metadata, createdAt.
- `GET /api/conversations?departmentId=` — list conversations for the authenticated tenant, optionally filtered by department (0 = unassigned).
- `GET /api/conversations/:id` — get single conversation (tenant-scoped).
- `GET /api/conversations/:id/messages` — list messages in a conversation.
- `POST /api/conversations/:id/messages` — send a message (creates outbound message record).
- `POST /api/conversations/:id/claim` — agent claims an unassigned conversation (sets assignedUserId + assignedAt, creates event).
- `POST /api/conversations/:id/transfer` — transfer to another agent (body: {targetUserId, note?}, creates event).
- `POST /api/conversations/:id/unassign` — release conversation back to pool (clears assignedUserId/assignedAt, creates event).
- `POST /api/conversations/:id/auto-route` — auto-route conversation using department's routing strategy (round_robin|load_balanced|last_assigned).
- `GET /api/conversations/:id/events` — get conversation audit trail.
- `GET /api/departments` — list departments for the tenant.
- `POST /api/departments` — create a department (name, description).
- `GET /api/departments/:id` — get a single department.
- `PATCH /api/departments/:id` — update department name/description/routingStrategy.
- `DELETE /api/departments/:id` — delete a department (conversations are unlinked via ON DELETE SET NULL).
- `GET /api/departments/:id/members` — list members of a department (joined with tenant_users).
- `POST /api/departments/:id/members` — add a tenant user to a department.
- `DELETE /api/departments/:id/members/:userId` — remove a member from a department.
- `GET /api/agents` — list all agents for the tenant (with status, skills, languages, departments).
- `POST /api/agents/invite` — invite/create a new agent (email, name, password, role).
- `PATCH /api/agents/:id` — update agent (name, role, skills, languages). Admin-only for role changes.
- `DELETE /api/agents/:id` — delete an agent. Admin-only.
- `POST /api/agents/status` — set own online/offline/away status.
- `GET /api/phone-numbers` — list phone numbers assigned to the tenant's departments.
- `GET /api/phone-numbers/search?country=&areaCode=` — search available Twilio numbers.
- `POST /api/phone-numbers/purchase` — purchase a Twilio number and optionally assign to a department.
- `POST /api/phone-numbers/assign` — assign/reassign a phone number to a department.

### User UI Pages
- `/app/login` — tenant login page (blue theme, "SAMA Messaging" branding).
- `/app/` — conversation inbox (2-panel: conversation list + message thread). Includes claim/transfer/unassign buttons, agent assignment info in header, activity log panel toggle, and agent status indicators on conversation cards.
- `/app/settings` — full workspace settings with tabbed UI: Departments (CRUD + routing strategy selector), Phone Numbers (search/purchase/assign Twilio numbers), Team (agent list with status dots, invite/edit/delete dialogs, skills & languages badges).
- AppShell: auth guard, dark sidebar with nav icons (inbox, settings, logout). Clickable status dot on user avatar cycles online→away→offline via `POST /api/agents/status`.
- Auth tokens stored in `sessionStorage` under key `sama_tenant_token`.

### Departments & Phone Numbers (Phase 2)
- `departments` table: `lib/db/src/schema/departments.ts` — id, tenant_id, name, phone_number, description, routingStrategy (round_robin|load_balanced|last_assigned, default round_robin), created_at. Tenant-scoped.
- `department_members` join table: same file — department_id, tenant_user_id (unique composite), created_at.
- `conversations.departmentId` nullable FK → `departments.id` with `ON DELETE SET NULL`.
- `conversations.assignedUserId` nullable FK → `tenant_users.id` with `ON DELETE SET NULL`.
- Inbox has department filter dropdown (All / Unassigned / per-department) and shows department badge + assigned agent on conversations.
- conductorAuth bypasses `/departments`, `/phone-numbers`, and `/agents` paths (these use `requireTenantAuth` instead).

### Team & Agent Management (Phase 3)
- Routing engine: `artifacts/api-server/src/lib/routing.ts` — picks online agents from department members using configured strategy (round_robin by lastAssignedAt, load_balanced by active conversation count, last_assigned by previous assignee).
- Agent status (online/offline/away) stored in `tenant_users.status`, toggled from AppShell sidebar.
- Skills & languages stored as comma-separated text in DB, returned as arrays in API responses.
- Conversation events table provides full audit trail (claimed, transferred, unassigned events with actor/target/note).
- Schema check updated to 11 tables (added conversation_events).

### OpenAPI Naming Convention
- Avoid `*Response` suffix on schema names — Orval generates both Zod consts and TS interfaces with same name, causing export collisions in `lib/api-zod`. Use `*Result` instead.

## Required secrets

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SAMA_FROM_NUMBER` — live Twilio sender.
- `CONDUCTOR_PASSWORD` (and optionally `CONDUCTOR_USERNAME`) — enforce admin auth.
- `SESSION_SECRET` — signs Bearer tokens for UI login.
- `SUPERUSER_EMAIL`, `SUPERUSER_PASSWORD` — auto-seed superuser on startup (env vars, not secrets).
- `N8N_WEBHOOK_URL` (optional) — downstream notification fan-out.
- `CHATWOOT_BASE_URL`, `CHATWOOT_API_ACCESS_TOKEN` — activate live Chatwoot bridge (Gate 3/4).
- `OPENAI_API_KEY` — activate the AI Student Whisperer (Gate 4). Optional `SAMA_STUDENT_MODEL` to override the default `gpt-4o-mini`.
- `Brand_registration_SID`, `Trust_Hub_A2P_Bundle_SID`, `Connected_Customer_Profile_SID` — 10DLC compliance monitor (Gate 5).
