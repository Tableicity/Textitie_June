# Textitie Run Book

_Last updated: June 8, 2026_
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
| Twilio outbound (per-tenant From numbers) | ✅ | **Live-verified 2026-06-07** (delivered from TFN) |
| Twilio inbound routing by tenant phone | ✅ | **Live-verified 2026-06-07** (routed to john-reynolds) |
| **A real Twilio phone number provisioned** | ✅ | **TFN +18887619212 LIVE (new account)** — assigned to john-reynolds |
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
| Inbox contact card (click header → ⋮ Edit) | ✅ | 2026-06-08 — edit Name/Preferred Language/Email/Tags/Notes; find-or-create by phone; inbox shows name. UI polish: header status word replaced with vertical ⋮ affordance; card ⋮ menu moved top-left, level with the X close |
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

**Nothing on the Twilio go-live path.** As of 2026-06-07 Textitie is LIVE on the new Twilio account (Toll-Free +18887619212): outbound, inbound routing, and webhook signature validation are all verified in production. Remaining items are non-blocking: Stripe live keys (no charging yet), the Halo inbox button, and prod verification of `OPENAI_API_KEY` / Chatwoot.

---

## 3. Twilio Go-Live Runbook

The moment Twilio hands you an active 10DLC-approved number, do these in order.

### 3.1 Set production secrets
Set these in the Replit deployment secrets (Production environment):

| Secret | Value source |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Console → Account → API keys & tokens |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account → API keys & tokens |
| `SAMA_FROM_NUMBER` | The approved sending number in **E.164**, e.g. `+18887619212`. This is what the sender uses as `From` — the code does **not** read a Phone Number SID. (Sender goes live when this + `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` are all set.) |
| `OPENAI_API_KEY` | OpenAI dashboard (required for Halo whispers) |

### 3.2 Attach the number to a tenant
This sets the tenant's **From** (outbound) and **inbound routing** number — `tenants.phoneNumber`.

1. Log in to the Conductor (admin) UI
2. Sidebar → **Tenants** → click the tenant → **Telephony** card
3. Pick a number from the dropdown — it lists **only numbers the connected Twilio account actually owns** (so you can't strand a tenant on a number we don't own, the Twilio 21660 trap). Choose **"Unassign — use platform default"** to fall the tenant back to `SAMA_FROM_NUMBER`.
4. Save. The picker validates against `GET /api/tenants/owned-numbers`; if the current number isn't owned it's flagged in red.

> Single-number reality: `tenants.phoneNumber` is also the **inbound** routing key, so only ONE tenant can own a given number for two-way. With one number (the TFN), `john-reynolds` owns it; other tenants left **unassigned** are outbound-only (they send from the `SAMA_FROM_NUMBER` fallback). ACME was unassigned on 2026-06-07 to clear its stale `+19094904265`.

> The sidebar **Phone Numbers** page assigns numbers to **departments** (`departments.phoneNumber`) and is **not** used by the send path — don't rely on it to change a tenant's From.

### 3.3 Configure Twilio webhooks
In Twilio Console → Phone Numbers → Manage → Active → click the number:

| Webhook | URL | Method |
|---|---|---|
| A message comes in | `https://textitie.com/api/webhooks/twilio` | `POST` |
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
- Verify webhook URL is `https://textitie.com/api/webhooks/twilio` (route is `/webhooks/:source` with source=`twilio`; no `/inbound` suffix, no trailing slash, no `/api/api/`).

### Halo whisper never appears
- Confirm `OPENAI_API_KEY` is set in **Production** secrets (not just dev).
- Confirm the tenant has uploaded at least one knowledge document via `/knowledge`.
- Check API server logs for `openai` errors (quota, auth, model name).

### Outbound message blocked
- Check `opt_outs` table for the recipient — they may have texted STOP.
- Check tenant quiet-hours and frequency-cap settings.
- Check billing — tenant may be out of credits or trial expired.

### Outbound shows `undelivered` / error 30003 ("Unreachable destination handset")
This is a **carrier/handset-side** result, not a platform bug. A row with a real Twilio `external_id` (`SM…`) means our code handed the message to Twilio and Twilio accepted it — the send fired. `30003` is written **only** by Twilio's status callback after the destination carrier refuses delivery; the code never fabricates it.

**How to diagnose against Twilio's own records** (the dev shell has the real Twilio creds in its environment; the code_execution sandbox does **not** — `viewEnvVars` only reports existence there). From the shell, basic-auth with `$TWILIO_ACCOUNT_SID` / `$TWILIO_AUTH_TOKEN` and never print the values:
- **Message by SID:** `GET api.twilio.com/2010-04-01/Accounts/{acc}/Messages/{SID}.json` → `status`, `error_code`, `from`, `to`, `date_sent`.
- **All traffic to/from a number:** `Messages.json?To=%2B1…` and `?From=%2B1…` (URL-encode the `+`). Zero inbound + all outbound 30003 to one number = two-way carrier/device block.
- **Line type / carrier:** `lookups.twilio.com/v2/PhoneNumbers/{num}?Fields=line_type_intelligence` → `carrier_name`, `type`.
- **Toll-free verification:** `messaging.twilio.com/v1/Tollfree/Verifications` → `status`.

**Observed case (2026-06-08):** the TFN +18887619212 delivers reliably to **Verizon** mobiles (e.g. +19096977635, +19097141794) and to other toll-free numbers, but every attempt to one specific **T-Mobile** mobile (+19093308683) returned 30003, in both directions (zero inbound from it). Toll-free verification was `TWILIO_APPROVED`, ruling out registration. Conclusion: a carrier/handset-side block on that one T-Mobile line. Resolution path is on the recipient/carrier side (T-Mobile Scam Shield `#662#`/`#732#`, device block list, line SMS provisioning) or a Twilio carrier escalation — no code change fixes it.

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

- **2026-06-08** — **Diagnosed a 30003 delivery dispute against Twilio's API (no code change).** Outbound "Beep" to a contact on **T-Mobile** (+19093308683) showed `undelivered` / 30003. Verified via Twilio REST from the dev shell: 4 attempts all `undelivered`/30003, zero inbound from that number, while the same TFN delivers fine to **Verizon** mobiles and other toll-free numbers; toll-free verification `TWILIO_APPROVED`. Root cause is a carrier/handset-side block on that one T-Mobile line, not the platform. Added a §6 troubleshooting entry documenting the Twilio-API diagnostic method (message-by-SID, To/From traffic, Lookup line-type, toll-free verification).
- **2026-06-07** — **Proper tenant-number assignment + compliance badge fix.** Added `GET /api/tenants/owned-numbers` (conductor-scoped, lists numbers the Twilio account owns) and turned the Tenant Detail **Telephony** card into a validated dropdown of owned numbers + Unassign (replaces the free-text E.164 field that let ACME get pointed at a non-owned number → 21660). Fixed ACME prod data: unassigned (`phoneNumber=null`) so it falls back to the TFN. Compliance "Tenant Number Inventory" badge now classifies by number type (**Toll-Free** vs **10DLC** vs N/A, column "SMS Registration") instead of the misleading `region===US` → "Required" — the TFN uses Toll-Free Verification, not 10DLC, and that badge was never a send gate. Backlog: optional server-side reject of non-owned numbers in `PATCH /tenants/:id`.
- **2026-06-07** — **Went LIVE on the new Twilio account (Toll-Free +18887619212).** Republished prod to load the new-account secrets (a saved-secret change does NOT restart an autoscale deployment — must republish); assigned the TFN to tenant `john-reynolds` via the Conductor PATCH API; smoke test passed end-to-end (outbound `delivered` from TFN; inbound reply signature-validated, routed to john-reynolds, conversation created in `/inbox`). Fixed a data bug: self-signup hardcoded `region:"us"` (lowercase) which 500'd `GET /api/tenants`; normalized existing tenants and changed the insert to `"US"`.
- **2026-05-26** — Reverted footer logo backdoor entry to `/knowledge`. Route and endpoint remain.
- **2026-05-26** — Added `/knowledge` self-serve Halo training page (tenant-auth gated, FormData upload, IDOR-checked).
- **2026-05-26** — Hardened `apiFetch` to skip JSON Content-Type for FormData bodies.
- Earlier — Added A2P 10DLC disclosure to Login and Signup to clear Twilio Error 30491.
- Earlier — Moved Inbox to `/inbox`, added public Landing at `/`, Phone Numbers to sidebar, ReminderBell in header.
