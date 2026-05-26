# Textitie Run Book

_Last updated: May 26, 2026_
_Product: **Textitie** (internal codename **SAMA** — Simple but Advanced Messaging Alternative)_
_Live: https://textitie.com_

This run book is the operational source-of-truth: where every feature stands, what's blocking, and exactly what to do the moment Twilio hands you a phone number.

---

## 1. Gate Table

### Legend
- ✅ Shipped & live on textitie.com
- 🟡 Built but stubbed / not production-wired
- 🔴 Not built
- ⏸️ Deferred by design
- 🔵 In progress (you, right now)
- ❓ Needs verification

---

### Gate 1 — Foundation
| Item | Status | Notes |
|---|---|---|
| Monorepo (pnpm) + contract-first OpenAPI | ✅ | `lib/api-spec/openapi.yaml` is source of truth |
| Postgres + Drizzle ORM, `public` schema + `tenant_id` scoping | ✅ | |
| Schema-per-tenant isolation (Stage 4) | ⏸️ | Deferred — re-enable when SOC2/HIPAA/sovereign-data forces it |
| Auto-seed (tiers, demo tenants, departments, billing) | ✅ | Idempotent |
| Conductor Basic Auth + tenant JWT | ✅ | `CONDUCTOR_PASSWORD` set |
| Published to `textitie.com` | ✅ | |

### Gate 2 — Core messaging
| Item | Status | Notes |
|---|---|---|
| Modular sender pipeline (pluggable) | ✅ | |
| Twilio outbound (per-tenant From numbers) | ✅ | Code ready |
| Twilio inbound routing by tenant phone | ✅ | Code ready |
| **A real Twilio phone number provisioned** | 🔵 | **You are here** |
| Twilio delivery webhooks (status callbacks) | ✅ | Wired |
| 10DLC Trust Hub compliance monitoring | ✅ | |
| A2P 10DLC disclosure on Login + Signup | ✅ | Shipped — fixes Twilio Error 30491 |
| Chatwoot bridging (sovereign + note posting) | 🟡 | Code ready; needs prod Chatwoot instance |

### Gate 3 — Agent inbox
| Item | Status | Notes |
|---|---|---|
| Two-panel inbox at `/inbox` | ✅ | |
| Claim / transfer / unassign / resolve | ✅ | |
| Whispers (internal notes) | ✅ | |
| Dispositions | ✅ | |
| Contacts + tagging + history | ✅ | |
| Conversation search & filters | ✅ | |
| Reminders (per-user, conversation-linked, ReminderBell) | ✅ | |
| Agent status indicators | ✅ | |
| Departments, roles, skills, languages, routing strategies | ✅ | |
| Phone Numbers admin (sidebar) | ✅ | |

### Gate 4 — Halo AI
| Item | Status | Notes |
|---|---|---|
| OpenAI `gpt-4o-mini` RAG pipeline (backend) | ✅ | |
| Knowledge ingestion (PDF/TXT/MD/CSV → text extraction via pdfjs) | ✅ | |
| Knowledge upload page `/knowledge` (direct URL only — backdoor reverted) | ✅ | |
| Whisper auto-draft as Chatwoot private note | ✅ | |
| **"Halo AI" button in inbox actually does something** | 🔴 | Currently a "coming soon" dialog placeholder (`Inbox.tsx:1240`) |
| `OPENAI_API_KEY` set in prod | ❓ | Confirm before Halo can run in production |
| Halo Library UI (browse/delete uploaded docs) | 🔴 | Today knowledge is append-only blob, no curation UI |

### Gate 5 — Compliance & TCPA
| Item | Status | Notes |
|---|---|---|
| Opt-out handling | ✅ | |
| Opt-ins + double opt-in | ✅ | |
| Quiet hours (tenant-level) | ✅ | |
| Frequency caps | ✅ | |
| Outbound compliance gate (blocks violations) | ✅ | |
| Audit log (indexed by entity/action/time) | ✅ | |
| HIPAA plan flag + BAA ack + PHI redaction | ✅ | Tier-gated |

### Gate 6 — Growth surfaces
| Item | Status | Notes |
|---|---|---|
| Campaigns (bulk SMS, segmentation, variable injection, scheduling) | ✅ | |
| Campaign credit checks + segment-aware billing | ✅ | |
| Campaign last-touch attribution (responses, opt-outs) | ✅ | |
| Automations (keyword reply, follow-up, auto-resolve, welcome, opt-out) | ✅ | |
| Shortcuts / message templates | ✅ | At `/automations` |
| CSAT surveys (auto-send, public response page, analytics) | ✅ | |
| Analytics dashboard `/analytics` + CSV export | ✅ | |

### Gate 7 — Billing
| Item | Status | Notes |
|---|---|---|
| Plans / tiers / per-message credits / metering / free trial | ✅ | Logic complete |
| Stripe checkout + webhooks | 🟡 | **Stubbed** — needs real Stripe keys to charge |

### Gate 8 — Integrations
| Item | Status | Notes |
|---|---|---|
| HubSpot connector (queue + worker + sim log) | 🟡 | Stub-first; needs real OAuth app |
| Other CRM connectors | 🔴 | None |

### Gate 9 — Public surface
| Item | Status | Notes |
|---|---|---|
| Landing `/` | ✅ | |
| `/login`, `/signup`, `/signup/trial`, `/verify` | ✅ | |
| `/privacy`, `/terms` | ✅ | |
| Footer logo backdoor → `/knowledge` | ❌ | **Reverted** at user request — direct URL still works |

---

## 2. What's blocking right now

**Twilio phone number provisioning.** Everything downstream waits on this.

---

## 3. Twilio Go-Live Runbook

The moment Twilio hands you an active 10DLC-approved number, do these in order.

### 3.1 Set production secrets
Set these in the Replit deployment secrets (Production environment):

| Secret | Value source |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Console → Account → API keys & tokens |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account → API keys & tokens |
| `TWILIO_PHONE_NUMBER_SID` | Twilio Console → Phone Numbers → Manage → Active → click number → Phone Number SID (starts with `PN…`) |
| `OPENAI_API_KEY` | OpenAI dashboard (required for Halo whispers) |

### 3.2 Attach the number to a tenant
1. Log in to the Conductor (admin) UI
2. Sidebar → **Phone Numbers**
3. Add the new `+1XXXXXXXXXX` number, assign it to the target tenant
4. Confirm the tenant's department routing covers this number

### 3.3 Configure Twilio webhooks
In Twilio Console → Phone Numbers → Manage → Active → click the number:

| Webhook | URL | Method |
|---|---|---|
| A message comes in | `https://textitie.com/api/webhooks/twilio/inbound` | `POST` |
| Status callback (Messaging Configuration) | `https://textitie.com/api/webhooks/twilio/status` | `POST` |

### 3.4 Verify 10DLC
- Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC
- Confirm Brand = **Registered**, Campaign = **Approved**, Number is **attached** to the campaign
- Confirm Trust Hub status surfaces correctly in the Conductor compliance panel

### 3.5 End-to-end smoke test
1. From your personal phone, text the Twilio number: **"Test"**
2. Within 5s the message should appear in `/inbox` for the assigned tenant
3. If `OPENAI_API_KEY` is set: Halo should attach a private-note draft within ~10s
4. Agent claims the conversation → replies → sender receives reply on personal phone
5. Send **"STOP"** from personal phone → opt-out should be recorded in `opt_outs` table, future sends should be blocked
6. Check `/analytics` — message counters should increment

If any step fails, see §6 Troubleshooting.

---

## 4. Highest-value remaining work (post-Twilio)

In priority order:

1. **Wire the Halo AI inbox button** to the real draft API instead of the "coming soon" dialog — your AI investment is invisible to agents until this is done.
2. **Stripe live keys + webhook** — you cannot actually take money today.
3. **Halo Library UI** — let tenants see/delete what they've uploaded (currently append-only blob).
4. **Confirm `OPENAI_API_KEY` in prod** — otherwise whispers silently fail.
5. **Production Chatwoot instance** — bridging code is ready but unconfigured.

---

## 5. Intentionally deferred

- **Stage 4 schema-per-tenant isolation** — rolled back; re-enable only when SOC2 / HIPAA / sovereign-data requires DB-level isolation. Re-enablement checklist lives in `replit.md`.
- **HubSpot real OAuth** — stub is fine for demo and sales conversations.

---

## 6. Troubleshooting

### Inbound SMS doesn't appear in `/inbox`
- Twilio Console → Monitor → Logs → Errors. Look for 4xx/5xx on the inbound webhook.
- Check the assigned tenant's phone number row exists and is mapped to a real department.
- Verify webhook URL is `https://textitie.com/api/webhooks/twilio/inbound` (no trailing slash, no `/api/api/`).

### Halo whisper never appears
- Confirm `OPENAI_API_KEY` is set in **Production** secrets (not just dev).
- Confirm the tenant has uploaded at least one knowledge document via `/knowledge`.
- Check API server logs for `openai` errors (quota, auth, model name).

### Outbound message blocked
- Check `opt_outs` table for the recipient — they may have texted STOP.
- Check tenant quiet-hours and frequency-cap settings.
- Check billing — tenant may be out of credits or trial expired.

### "Conductor authentication required" on a tenant route
- That route isn't in the conductorAuth exemption list at `artifacts/api-server/src/middleware/conductorAuth.ts`. Add the path prefix.

---

## 7. Operational quick reference

### Routes (user-app, https://textitie.com)
**Public:** `/`, `/login`, `/verify`, `/signup`, `/signup/trial`, `/privacy`, `/terms`
**Auth-gated:** `/inbox`, `/contacts`, `/settings`, `/billing`, `/automations`, `/campaigns`, `/analytics`, `/knowledge`

### Routes (admin Conductor)
Served at `/admin/` — multi-tenant management, Phone Numbers, compliance, message injection, webhook monitoring.

### Key files (for engineers)
| File | Purpose |
|---|---|
| `lib/api-spec/openapi.yaml` | API contract — change here first, then run codegen |
| `artifacts/api-server/src/middleware/conductorAuth.ts` | Admin Basic Auth + exemption list |
| `artifacts/api-server/src/middleware/tenantAuth.ts` | Tenant JWT verification |
| `artifacts/api-server/src/routes/tenants.ts` | Tenant CRUD + knowledge upload |
| `artifacts/user-app/src/pages/Inbox.tsx` | Agent inbox (Halo button placeholder at line ~1240) |
| `artifacts/user-app/src/pages/Knowledge.tsx` | Halo training upload page |
| `lib/db/src/tenant-db.ts` | `getTenantDb` / `getTenantPool` — currently returns global pool |
| `replit.md` | Architecture overview + Stage 4 re-enablement notes |

### Codegen command (after editing OpenAPI)
```bash
pnpm --filter @workspace/api-spec run codegen
```

### Typecheck before deploy
```bash
pnpm run typecheck
```

### Restart a workflow
Use the workflows tool or `restart_workflow <name>` — never run `pnpm dev` at repo root.

---

## 8. Change log highlights (recent)

- **2026-05-26** — Reverted footer logo backdoor entry to `/knowledge`. Route and endpoint remain.
- **2026-05-26** — Added `/knowledge` self-serve Halo training page (tenant-auth gated, FormData upload, IDOR-checked).
- **2026-05-26** — Hardened `apiFetch` to skip JSON Content-Type for FormData bodies.
- Earlier — Added A2P 10DLC disclosure to Login and Signup to clear Twilio Error 30491.
- Earlier — Moved Inbox to `/inbox`, added public Landing at `/`, Phone Numbers to sidebar, ReminderBell in header.
