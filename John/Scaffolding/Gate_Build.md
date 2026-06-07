# Gate Build — Textitie (SAMA)

> **Document control:** This is the living build ledger for Textitie. The Agent maintains revision control over this file as a Prime Directive. Every feature/change appends a dated entry to §6 Revision Log and updates §3 Gate Table where status changes.
>
> _Product:_ **Textitie** (internal codename **SAMA** — Simple but Advanced Messaging Alternative)
> _Live:_ https://textitie.com
> _Repo:_ https://github.com/TransferAgent/textitie.git
> _Companion docs:_ `John/Scaffolding/Regeneration.md` (compaction recovery), `John/Scaffolding/architecture.doc.md` (architecture lessons + day-one checklist — append-only reference), `John/Scaffolding/Hardening.md` (production hardening backlog — living), `John/Scaffolding/Database_URL_work.md` (dev/prod DB env split — active task), `John/Run_Book.md` (operational runbook)
> _Created:_ June 7, 2026

---

## 1. Latest Status Report (verbatim — most recent systems + document check)

_Captured June 7, 2026. This is the agent's last full report, preserved verbatim per request._

### Document Check
All operational docs present and intact in `John/`:
- **`Run_Book.md`** (248 lines) — Gate Table + Twilio go-live runbook, last updated May 26
- `Twilio.md`, `Privacy-Policy.md`, `Terms-of-Service.md`, architecture/phase docs, Stage 4 backups
- `replit.md` and `README.md` at root — current and consistent

**Documentation discrepancy found:** Run_Book §3.1 says to set `TWILIO_PHONE_NUMBER_SID` to go live. The code does **not** read that. The sender (`senders/index.ts`) goes live only when **`SAMA_FROM_NUMBER`** (the actual `+1…` number in E.164) is set, alongside `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`. The runbook's secret name is wrong.

### Systems Check (live, read-only)

| Check | Result |
|---|---|
| Production `https://textitie.com/api/healthz` | ✅ 200 `{"status":"ok"}` |
| All 4 workflows (api-server, eng-architect, user-app, mockup-sandbox) | ✅ running |
| **Dev** sender mode | ✅ **Live Twilio direct** — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, **`SAMA_FROM_NUMBER`** all set, so it is NOT on the stub |
| `OPENAI_API_KEY` (Halo) | ✅ set in dev |
| `CHATWOOT_BASE_URL` + `CHATWOOT_API_ACCESS_TOKEN` | ✅ set in dev — Chatwoot now looks configured (Run_Book still marks it 🟡) |
| `STRIPE_SECRET_KEY` | ❌ not set — billing still stubbed |
| `SAMA_SENDER` override | not set (so it auto-selects live, good) |

**Important caveat:** the values above are the **development** environment's secrets. Production deployment secrets cannot be read from the dev shell. Before any live SMS test on textitie.com, confirm the **Production** environment has `SAMA_FROM_NUMBER` set to the approved Toll-Free number (plus the Twilio SID/token).

### Two things specific to the new Twilio situation
1. **Toll-Free ≠ 10DLC.** The approved Toll-Free number uses Twilio's **Toll-Free Verification**, a separate track from A2P 10DLC. Outbound/inbound sending works identically — the code just uses the number as the `from`. The catch: the Conductor **compliance panel is wired to the 10DLC `BrandRegistrations`/Trust Hub APIs**, so it will **not** reflect Toll-Free verification status until/unless the 10DLC long code comes through.
2. **Can likely go live on the Toll-Free number now.** The old Run_Book blocker ("provision a number — you are here") is effectively cleared. Remaining gate is configuration + webhook wiring, not building.

---

## 2. How We Got Here (narrative history)

This is the condensed lineage of the build, oldest → newest, so any reader (or a fresh agent post-compaction) understands the path.

1. **Foundation (Gate 1).** pnpm monorepo, contract-first OpenAPI (`lib/api-spec/openapi.yaml`), Postgres + Drizzle. Conductor Basic Auth + tenant JWT. Auto-seed. Published to `textitie.com`.
2. **Core messaging (Gate 2).** Modular sender pipeline with pluggable senders (`twilio` direct + `stub` fallback). Inbound routing by tenant phone, per-tenant `From`, delivery status webhooks. 10DLC Trust Hub compliance monitoring built.
3. **Stage 4 multi-tenancy — attempted, then DEFERRED.** Schema-per-tenant isolation was half-migrated (webhook writes went to `tenant_<slug>.*` while the inbox kept reading `public.*`), silently dropping auto-replies/opt-outs/attribution. Rolled back at the data layer: `getTenantDb`/`getTenantPool` now return the global pool; everything reads/writes `public.*` scoped by `tenant_id`. Re-enablement checklist lives in `replit.md`.
4. **Agent inbox (Gate 3).** Two-panel inbox moved to `/inbox`, public Landing at `/`. Claim/transfer/unassign/resolve, whispers, dispositions, contacts+tagging, search/filters, reminders, agent status, departments/roles/skills/routing, Phone Numbers admin.
5. **Halo AI (Gate 4).** OpenAI `gpt-4o-mini` RAG pipeline + knowledge ingestion (PDF/TXT/MD/CSV via pdfjs). `/knowledge` self-serve upload page (tenant-auth gated, IDOR-checked). Whisper auto-draft as Chatwoot private note. **Inbox "Halo AI" button is still a placeholder dialog** — not wired to the live draft API.
6. **Compliance & growth (Gates 5–6).** Opt-outs/opt-ins/double opt-in, quiet hours, frequency caps, outbound compliance gate, audit log, HIPAA flag + BAA + PHI redaction. Campaigns (bulk, segmentation, scheduling, attribution), automations, shortcuts, CSAT surveys, analytics + CSV.
7. **Billing (Gate 7).** Plans/tiers/credits/metering/trial logic complete; **Stripe is stubbed** — no real charging yet.
8. **Recent session work (May–June 2026):**
   - Pushed repo to GitHub; created `README.md`; updated `replit.md`; created `John/Run_Book.md`.
   - Harmonized the three auth cards (`/login`, `/signup`, `/signup/trial`) to identical dimensions; renamed Signup "Company Name" → "Full Name"; added a Phone field.
   - **Phone persistence:** added nullable `phone` column to `tenant_users`, wired `/tenant-auth/register` to require + normalize a 10-digit US phone, store it on the owner record; owner `name` now the submitted full name (was email prefix); hardened `companyName` trim/length validation. Migrated via drizzle push; smoke-tested.
   - **Twilio A2P fix:** Twilio rejected the campaign. Made the SMS-consent checkbox **non-blocking** (submit no longer gated by `!smsConsent`) and replaced consent copy on all three cards with the approved wording ("By checking this box, I consent to receive automated customer support text messages from Textitie. Consent is not required to create an account or complete a service…") keeping Privacy Policy + Terms links. Deployed.
   - **New Twilio account:** user reports a **new Twilio account approved on a Toll-Free Number**, with a regular 10DLC long code **in progress**.

---

## 3. Gate Table (current — authoritative)

### Legend
✅ Shipped & live · 🟡 Built but stubbed/not prod-wired · 🔴 Not built · ⏸️ Deferred by design · 🔵 In progress · ❓ Needs verification

#### Gate 1 — Foundation
| Item | Status | Notes |
|---|---|---|
| Monorepo (pnpm) + contract-first OpenAPI | ✅ | `lib/api-spec/openapi.yaml` source of truth |
| Postgres + Drizzle, `public` schema + `tenant_id` scoping | ✅ | |
| Schema-per-tenant isolation (Stage 4) | ⏸️ | Deferred until SOC2/HIPAA/sovereign-data forces it |
| Auto-seed (tiers, tenants, departments, billing) | ✅ | Idempotent |
| Conductor Basic Auth + tenant JWT | ✅ | `CONDUCTOR_PASSWORD` set |
| Published to `textitie.com` | ✅ | health 200 |

#### Gate 2 — Core messaging
| Item | Status | Notes |
|---|---|---|
| Modular sender pipeline (pluggable) | ✅ | `senders/index.ts` auto-selects twilio→stub |
| Twilio outbound (per-tenant From) | ✅ | Code ready |
| Twilio inbound routing by tenant phone | ✅ | Code ready |
| **Real Twilio number provisioned** | ✅ | **Toll-Free approved (new account)** |
| **10DLC long code** | 🔵 | **In progress (user)** |
| Twilio delivery webhooks (status callbacks) | ✅ | Wired |
| 10DLC Trust Hub compliance monitoring | ✅ | Wired to A2P `BrandRegistrations`/Trust Hub |
| Compliance panel reflects **Toll-Free** status | ❓ | Panel is 10DLC-only — will NOT show TFN verification |
| A2P/consent disclosure on Login + Signup | ✅ | Reworded; checkbox non-blocking |
| Prod `SAMA_FROM_NUMBER` = approved number | ❓ | **Must verify in Production secrets** |
| Chatwoot bridging (sovereign + note posting) | ❓ | Creds set in dev; verify prod instance |

#### Gate 3 — Agent inbox
| Item | Status | Notes |
|---|---|---|
| Two-panel inbox at `/inbox` | ✅ | |
| Claim/transfer/unassign/resolve | ✅ | |
| Whispers, dispositions | ✅ | |
| Contacts + tagging + history | ✅ | |
| Conversation search & filters | ✅ | |
| Reminders (per-user, conversation-linked) | ✅ | |
| Agent status indicators | ✅ | |
| Departments, roles, skills, languages, routing | ✅ | |
| Phone Numbers admin (sidebar) | ✅ | |

#### Gate 4 — Halo AI
| Item | Status | Notes |
|---|---|---|
| OpenAI `gpt-4o-mini` RAG pipeline (backend) | ✅ | |
| Knowledge ingestion (PDF/TXT/MD/CSV) | ✅ | pdfjs text extraction |
| `/knowledge` upload page | ✅ | tenant-auth gated, IDOR-checked |
| Whisper auto-draft as Chatwoot note | ✅ | |
| **Inbox "Halo AI" button wired to draft API** | 🔴 | Placeholder "coming soon" dialog |
| `OPENAI_API_KEY` in prod | ❓ | Set in dev; confirm prod |
| Halo Library UI (browse/delete docs) | 🔴 | Append-only blob, no curation UI |

#### Gate 5 — Compliance & TCPA
| Item | Status | Notes |
|---|---|---|
| Opt-out handling | ✅ | |
| Opt-ins + double opt-in | ✅ | |
| Quiet hours (tenant-level) | ✅ | |
| Frequency caps | ✅ | |
| Outbound compliance gate | ✅ | Blocks violations |
| Audit log (indexed) | ✅ | |
| HIPAA flag + BAA ack + PHI redaction | ✅ | Tier-gated |

#### Gate 6 — Growth surfaces
| Item | Status | Notes |
|---|---|---|
| Campaigns (bulk, segmentation, variables, scheduling) | ✅ | |
| Campaign credit checks + segment-aware billing | ✅ | |
| Campaign last-touch attribution | ✅ | |
| Automations (keyword/follow-up/auto-resolve/welcome/opt-out) | ✅ | |
| Shortcuts / message templates | ✅ | At `/automations` |
| CSAT surveys (auto-send, public page, analytics) | ✅ | |
| Analytics dashboard `/analytics` + CSV export | ✅ | |

#### Gate 7 — Billing
| Item | Status | Notes |
|---|---|---|
| Plans/tiers/credits/metering/trial | ✅ | Logic complete |
| Stripe checkout + webhooks | 🟡 | **Stubbed** — needs real keys to charge |

#### Gate 8 — Integrations
| Item | Status | Notes |
|---|---|---|
| HubSpot connector (queue + worker + sim log) | 🟡 | Stub-first; needs real OAuth app |
| Other CRM connectors | 🔴 | None |

#### Gate 9 — Public surface
| Item | Status | Notes |
|---|---|---|
| Landing `/` | ✅ | |
| `/login`, `/signup`, `/signup/trial`, `/verify` | ✅ | |
| `/privacy`, `/terms` | ✅ | |

---

## 4. Where We Are (one-line summary)

**Build is feature-complete through Gate 6. The single live-traffic blocker is Twilio number go-live config — and that blocker is now mostly cleared because a Toll-Free number is approved.** Remaining go-live work is configuration (verify prod secrets, wire webhooks, smoke test), not building. Stripe and the Halo inbox button are the next real build items.

---

## 5. Next Steps (candidate backlog — execute only after discussion)

Priority order. Nothing here is started without explicit sign-off.

1. **Go live on the Toll-Free number** — confirm Production secrets (`SAMA_FROM_NUMBER` = the approved TFN, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`); set Twilio webhooks (inbound `…/api/webhooks/twilio/inbound`, status `…/api/webhooks/twilio/status`); run the Run_Book §3.5 smoke test.
2. **Fix Run_Book secret-name error** (`TWILIO_PHONE_NUMBER_SID` → `SAMA_FROM_NUMBER`) and sync its Gate Table to §3 above.
3. **Decide compliance-panel handling for Toll-Free** — leave as-is pending the 10DLC long code, or add TFN verification status surfacing.
4. **Wire the Halo AI inbox button** to the real draft API (replace the "coming soon" dialog).
5. **Stripe live keys + webhook** — enable real charging.
6. **Halo Library UI** — browse/delete uploaded knowledge docs.
7. **Verify/confirm prod** `OPENAI_API_KEY` and the Chatwoot production instance.
8. **DATABASE_URL dev/prod separation** — execute the plan in `Scaffolding/Database_URL_work.md` before real customer data lands in prod.
9. **Production hardening pass** — work the `Scaffolding/Hardening.md` backlog (starting with Twilio webhook signature validation — HIGH) before pointing a paying customer at the system.

### Competitor-gap backlog (from `John/Textline.md` — not yet built)
Features Textline offers that SAMA/Textitie does not yet have. Lower priority than the go-live + monetization items above.
- **MMS support** — send/receive photos, PDFs, links (media messaging).
- **Group messaging** — multiple contacts in one thread.
- **Native mobile apps** — iOS / Android.
- **Self-service number provisioning** — tenants buy/text-enable their own Twilio numbers in-app.
- **Additional CRM/channel connectors** — Salesforce, Zendesk, Slack, Zapier, Facebook/Instagram (only HubSpot is stubbed today).
- **Web chatbot add-on**, **IP whitelisting**, **SAML/SSO**, **public developer API & webhooks**.

---

## 6. Revision Log

The agent appends a dated entry here for every build action taken against this project going forward. Format: date — what changed — gate(s) affected.

- **2026-06-07** — Created `John/Scaffolding/` with `Gate_Build.md` (this ledger) and `Regeneration.md` (compaction-recovery doc). No code/feature changes. Captured the June 7 systems + document check verbatim (§1). Established the current authoritative Gate Table (§3).
- **2026-06-07** — Moved `John/architecture.doc.md` → `John/Scaffolding/architecture.doc.md` to consolidate build-governance docs. Updated the README link. Classified it as an **append-only lessons reference** (not a per-session living doc): add a new lesson when a build decision/incident teaches something durable; do not rewrite existing entries. Wired it into the companion-doc lists in this file and `Regeneration.md`.
- **2026-06-07** — Scaffolding triage of `John/`. Subagent review classified every loose `.md`. Actions: (1) moved the two **living build-governance** docs — `Hardening.md` (production hardening backlog) and `Database_URL_work.md` (dev/prod DB env split) — into `Scaffolding/` and wired them into companion-doc lists + key-files maps; added them to §5 Next Steps (items 8–9). (2) Created `John/Archive/` and moved 7 **static/historical, superseded** docs there: `Phase7.1.md`, `Phase7.2.md`, `Phase9.1.md`, `Stage4-Migration.md`, `MultiTenant.md`, `User_UI_Gate_Plan.md`, `Things To Do.md`. (3) Folded `John/Textline.md`'s open competitor gaps into §5 as a "Competitor-gap backlog". Left at `John/` root: `Run_Book.md` + `Twilio.md` (operational), `Privacy-Policy.md` + `Terms-of-Service.md` (published-content sources, verified to mirror the live pages), `Textline.md` (roadmap input). No code/feature changes.
