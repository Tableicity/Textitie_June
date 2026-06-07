---
name: Regeneration / compaction-recovery protocol
description: How a fresh or post-compaction agent resumes the Textitie/SAMA build without losing state.
---

# Regeneration protocol (read this first after any compaction or new session)

**On session start or right after a context compaction, read these on-disk docs before doing anything else** — they are the source of truth and survive compaction (they live in the user's repo):

1. `John/Scaffolding/Regeneration.md` — Prime Directive + fast systems check + in-flight task (§3). **Read this first.**
2. `John/Scaffolding/Gate_Build.md` — authoritative Gate Table (§3), where-we-are (§4), Next Steps backlog (§5), Revision Log (§6).
3. `John/Run_Book.md` — operational/Twilio go-live runbook.
4. `replit.md` — architecture + Stage 4 deferral notes + user preferences.

Supporting governance docs also in `John/Scaffolding/`: `architecture.doc.md` (append-only lessons), `Hardening.md` (prod hardening backlog), `Database_URL_work.md` (dev/prod DB split). Superseded history is in `John/Archive/`.

**Standing rule from the user:** take NO build/code action without discussing and getting approval first. Documentation tasks are pre-approved only when explicitly requested.

**Why:** the user explicitly asked whether compaction recovery was wired into persistent memory. The Regeneration doc is safe on disk but nothing auto-pointed to it, so a fresh agent wouldn't know to open it. This file is that pointer.

**How to apply:** if you wake up unsure of project state, do not guess or re-explore from scratch — open `John/Scaffolding/Regeneration.md` and follow its Prime Directive. The user can simply say "regenerate" or "read the regeneration doc" to trigger this, but you should do it automatically on a cold start.

## Operating agreement (established 2026-06-07)

- **Two Primes:** (1) no loss of state across compaction; (2) **do not let anything break** — protect live `textitie.com` above all.
- **Agent has veto** over the build. If the human (John) requests something that would break prod or skip verification, **push back and refuse** until resolved.
- **Roles:** agent does the heavy lifting inside the environment and directs the order of operations; John executes outside actions (Twilio console, Secrets tab, accounts) and reports back, following the agent's directed sequence.
- **Twilio creds are GLOBAL secrets** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SAMA_FROM_NUMBER`) — not environment-scoped, so changing them hits **dev and prod simultaneously**. Treat any swap as a production change: update all three together (same account) and verify immediately. Never set `SAMA_SENDER` (leave unset for auto-live; `=stub` silently kills live sending). `TWILIO_PHONE_NUMBER_SID` is **not read by the code** — ignore the Run_Book instruction to set it.
- **Correct webhook URLs** (endpoints are exempt from Conductor Basic Auth; inbound is Twilio-signature-gated using the Auth Token): inbound `https://textitie.com/api/webhooks/twilio` (POST), status `https://textitie.com/api/webhooks/twilio/status` (POST). The "`/twilio/inbound`" form in older docs is wrong.
