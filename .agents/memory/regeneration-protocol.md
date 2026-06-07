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
