---
name: Cold-start / operating agreement (Textitie/SAMA)
description: How a fresh or post-compaction agent resumes the Textitie/SAMA build, plus the standing operating agreement with the user.
---

# Cold-start recovery (read after any compaction or new session)

**`replit.md` is the single source of truth for build status and architecture.** On a cold start, read it first — it carries the overview, architecture, Stage-4 deferral, and user preferences, and the platform keeps it current.

The "Scaffolding" gate-ledger experiment (`John/Scaffolding/Gate_Build.md` + `Regeneration.md`) was **retired 2026-06-08** and archived in `John/Archive/`.
**Why:** it promised a self-maintaining "no look back" ledger, but parallel task agents merge in isolation and only update `replit.md`, so the gate ledger silently desynced after every merge and the user had to keep reminding the agent to reconcile it — friction with no payoff.
**How to apply:** do NOT recreate a gate ledger, a Regeneration doc, or any separate build-status ceremony, and do not ask the user to maintain status docs. Track status in `replit.md`. Status tracking is the agent's job, not the user's.

`John/` root keeps only living **operational** references (not status ceremony): `Run_Book.md` (Twilio go-live runbook, secrets, diagnostics), `Hardening.md` (prod-hardening backlog), `Database_URL_work.md` (dev/prod DB split task), `architecture.doc.md` (append-only durable lessons). Update these when the relevant operational facts change.

## Operating agreement (established 2026-06-07)

- **Two Primes:** (1) no loss of state across compaction; (2) **do not let anything break** — protect live `textitie.com` above all.
- **Agent has veto** over the build. If the human (John) requests something that would break prod or skip verification, **push back and refuse** until resolved.
- **Standing rule:** take NO build/code action without discussing and getting approval first. Documentation tasks are pre-approved only when explicitly requested.
- **Roles:** agent does the heavy lifting inside the environment and directs the order of operations; John executes outside actions (Twilio console, Secrets tab, accounts) and reports back, following the agent's directed sequence.
- **Twilio creds are GLOBAL secrets** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SAMA_FROM_NUMBER`) — not environment-scoped, so changing them hits **dev and prod simultaneously**. Treat any swap as a production change: update all three together (same account) and verify immediately. Never set `SAMA_SENDER` (leave unset for auto-live; `=stub` silently kills live sending). `TWILIO_PHONE_NUMBER_SID` is **not read by the code** — ignore the Run_Book instruction to set it.
- **Correct webhook URLs** (endpoints are exempt from Conductor Basic Auth; inbound is Twilio-signature-gated using the Auth Token): inbound `https://textitie.com/api/webhooks/twilio` (POST), status `https://textitie.com/api/webhooks/twilio/status` (POST). The "`/twilio/inbound`" form in older docs is wrong.
