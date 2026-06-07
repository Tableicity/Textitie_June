# Regeneration — Textitie (SAMA) Compaction Recovery

> **PRIME DIRECTIVE.** This document exists so that after a context compaction (or a brand-new agent session), the build can continue **without loss of state**. The agent maintains document control over this file: it is re-read at the start of work and updated at the end of every build session. If this file and live reality disagree, trust the code/secrets and update this file.
>
> _Product:_ **Textitie** (internal codename **SAMA**). _Live:_ https://textitie.com · _Repo:_ https://github.com/TransferAgent/textitie.git
> _Companion:_ `John/Scaffolding/Gate_Build.md` (full ledger + Gate Table), `John/Run_Book.md` (ops runbook), `replit.md` (architecture).
> _Last regenerated:_ June 7, 2026

---

## 0. READ-ME-FIRST (recovery protocol for a fresh/compacted agent)

Do these in order before touching anything:
1. Read this whole file.
2. Read `John/Scaffolding/Gate_Build.md` §3 (Gate Table) and §5 (Next Steps).
3. Read `replit.md` (architecture, Stage 4 deferral, GitHub push command).
4. Run the **Fast Systems Check** in §4 below to confirm reality matches this doc.
5. Confirm the **active task** in §3 with the user before executing — never assume an in-flight task should proceed without a check-in.

---

## 1. What this product is (90-second orientation)

Textitie is a multi-tenant two-way SMS platform (Textline-style agent inbox) on a pnpm monorepo. Tenants send/receive SMS via Twilio, agents work conversations in `/inbox`, an admin "Conductor" oversees tenants at `/admin/`, and "Halo AI" (OpenAI `gpt-4o-mini` + RAG over uploaded docs) drafts replies. Compliance (TCPA/10DLC), campaigns, automations, surveys, analytics, and (stubbed) Stripe billing are built.

**Architecture essentials:**
- **Contract-first:** edit `lib/api-spec/openapi.yaml` first, then `pnpm --filter @workspace/api-spec run codegen`.
- **DB:** Postgres + Drizzle, **all data in `public` schema**, every per-tenant table has explicit `tenant_id`. Stage 4 schema-per-tenant is **deferred** (`getTenantDb`/`getTenantPool` return the global pool).
- **Artifacts:** `api-server` (Express, `/api`), `eng-architect` (admin Conductor UI, `/admin/`), `user-app` (agent + public UI, `/`), `mockup-sandbox` (canvas previews).

---

## 2. Current build state (the single source of truth for "where we are")

- **Feature-complete through Gate 6.** Gates 1–6 ✅. Gate 7 (Stripe) 🟡 stubbed. Gate 8 (HubSpot) 🟡 stub. See `Gate_Build.md` §3 for the full table.
- **Twilio:** new account; **Toll-Free number approved**; **10DLC long code in progress (user)**. Sending code is ready and goes live when `SAMA_FROM_NUMBER` + `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` are all set.
- **Known open build items:** Halo inbox button is a placeholder dialog (not wired to draft API); Stripe not chargeable; Halo Library UI not built; compliance panel is 10DLC-only (won't reflect a Toll-Free number).

---

## 3. ACTIVE TASK / IN-FLIGHT STATE

> Update this section at the **end of every session** so a compacted agent knows exactly what was happening. If nothing is in flight, say so.

- **Active task:** None in progress. Last completed: provisioned `John/Scaffolding/` with `Gate_Build.md` + `Regeneration.md` (this file).
- **Awaiting user decision on:** which Next Step to start (see `Gate_Build.md` §5). Most likely next: Toll-Free go-live config OR wiring the Halo inbox button.
- **Do-not-proceed-without-discussion:** The user has set a standing rule — **take no build action until it has been discussed and approved.** Honor this.

---

## 4. Fast Systems Check (copy-paste, read-only)

Run these to confirm the environment before building. (Dev shell cannot read Production secrets — verify those in the Replit deployment settings UI.)

```bash
# Live prod + local health
curl -s -o /dev/null -w "%{http_code}\n" https://textitie.com/api/healthz
curl -s -o /dev/null -w "%{http_code}\n" localhost:80/api/healthz

# Which secrets are present in THIS (dev) environment
for v in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN SAMA_FROM_NUMBER SAMA_SENDER \
         OPENAI_API_KEY CHATWOOT_BASE_URL CHATWOOT_API_ACCESS_TOKEN STRIPE_SECRET_KEY; do
  if [ -n "${!v}" ]; then echo "$v = <set>"; else echo "$v = <NOT set>"; fi
done

# Typecheck before any deploy
pnpm run typecheck
```

**Sender selection logic** (`artifacts/api-server/src/lib/senders/index.ts`): live Twilio requires `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `SAMA_FROM_NUMBER`. `SAMA_SENDER=stub` forces stub. Otherwise falls back to stub.

**Expected dev result (as of 2026-06-07):** prod 200, local 200; `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SAMA_FROM_NUMBER`, `OPENAI_API_KEY`, `CHATWOOT_*` set; `STRIPE_SECRET_KEY` not set; `SAMA_SENDER` not set.

---

## 5. Critical conventions & traps (don't relearn the hard way)

- **No `pnpm dev` at repo root.** Apps run via Replit workflows. Restart with `restart_workflow <name>`. After changing api-server code, restart its workflow or the running server keeps the old code (verified trap).
- **Verify with `typecheck`, not `build`** (`build` needs workflow-provided `PORT`/`BASE_PATH`).
- **Lib change → run `pnpm run typecheck:libs` first**, then leaf artifacts. After DB schema change run `pnpm --filter @workspace/db run push`.
- **Run_Book §3.1 has a wrong secret name:** it says `TWILIO_PHONE_NUMBER_SID`; the code reads **`SAMA_FROM_NUMBER`** (E.164 number). Fix pending.
- **Toll-Free ≠ 10DLC.** Sending works identically; the compliance panel is wired to 10DLC `BrandRegistrations`/Trust Hub and won't show TFN verification status.
- **A2P consent checkbox is intentionally non-blocking** (Twilio rejection fix) — do not re-gate submit on it. Approved wording lives on all three auth cards.
- **GitHub push** (one-off): `git push "https://TransferAgent:${GITHUB_TEXTITIE}@github.com/TransferAgent/textitie.git" main`. Destructive git ops are blocked for the main agent.
- **Stage 4 is deferred** — do not reintroduce schema-per-tenant reads; everything is `public.*` scoped by `tenant_id`.
- **Webhook URLs:** inbound `https://textitie.com/api/webhooks/twilio/inbound`, status `https://textitie.com/api/webhooks/twilio/status` (no trailing slash, no `/api/api/`).

---

## 6. Key files map

| File | Purpose |
|---|---|
| `lib/api-spec/openapi.yaml` | API contract — edit first, then codegen |
| `artifacts/api-server/src/lib/senders/index.ts` | Sender selection (twilio→stub) |
| `artifacts/api-server/src/lib/senders/twilio.ts` | Twilio direct sender |
| `artifacts/api-server/src/routes/webhooks.ts` | Twilio inbound + status callbacks |
| `artifacts/api-server/src/routes/tenantAuth.ts` | Tenant register/login (phone capture) |
| `artifacts/api-server/src/middleware/conductorAuth.ts` | Admin Basic Auth + exemption list |
| `artifacts/api-server/src/routes/compliance.ts` | 10DLC/Trust Hub status |
| `artifacts/user-app/src/pages/Inbox.tsx` | Agent inbox (Halo button placeholder ~line 1240) |
| `artifacts/user-app/src/pages/Login.tsx` / `Signup.tsx` | Auth cards + A2P consent |
| `artifacts/user-app/src/pages/Knowledge.tsx` | Halo training upload |
| `lib/db/src/tenant-db.ts` | `getTenantDb`/`getTenantPool` → global pool (Stage 4 deferred) |
| `John/Run_Book.md` | Ops runbook + Twilio go-live |
| `John/Scaffolding/Gate_Build.md` | Build ledger + Gate Table (authoritative) |

---

## 7. Maintenance rules for THIS document (Prime Directive)

1. **At session start:** read this file + `Gate_Build.md`; run §4 Fast Systems Check; reconcile §2/§3 with reality.
2. **At session end:** update §3 (Active Task), bump §2 if gate status changed, update "Last regenerated" date, and append the change to `Gate_Build.md` §6 Revision Log.
3. **On any gate status change:** update both this file (§2) and `Gate_Build.md` (§3) in lockstep.
4. **Never** store secret *values* here — only names and set/not-set status.
5. If compaction is imminent, ensure §3 captures the exact in-flight step (file being edited, next action) so work resumes seamlessly.
