# Things To Do — Post-Phase 9.1 Retrospective & Roadmap

> Saved from agent retrospective on Phase 7.1 (May 2026). Phase 7.1 is shipped; this doc captures what aged well, gaps to revisit, and the recommended next session.

---

## Reality check

Phase 7.1 is already shipped. All five items in `Phase7.1.md` — whispers, dispositions, contacts, search/filter, reminders — are live in the codebase and documented in `replit.md` under "Phase 7.1 — Advanced Inbox Features." The doc is the completed plan that matches what's actually running.

---

## What aged well

- The "additive schema only" rule kept the migration painless — every new column on `conversations` is nullable, so nothing existing broke.
- Putting whispers on `messages.direction='internal'` instead of a separate table was the right call. The Twilio sender naturally ignores it (only `outbound` ships), so there's zero risk of accidentally texting a customer an internal note.
- Reusing the 60s timer engine for reminder firing avoided a whole new worker process. Same engine now also runs the Phase 9.1 CRM sync queue and HIPAA-aware compliance — that pattern has paid off three times.

---

## What I'd push back on now (with hindsight)

- The doc says "30s polling" for the reminder bell. That's what we shipped, and it works, but with the audit log + sync queue + reminders + sometimes campaigns all polling, the inbox session is making a lot of background requests. Worth considering a single SSE/long-poll channel later — not urgent.
- "URL-synced filters via wouter query string so bookmarks work" — not fully wired. Filters work in-session but don't survive a refresh. Minor gap.
- The dispositions analytics breakdown was explicitly punted ("out of scope unless time permits"). Still punted. A "by disposition" pie/bar would be a small, high-value follow-up — probably 30 min of work.

---

## The deferred items (6–8) — status

- **Surveys (CSAT/NPS):** still untouched. Most valuable of the three for a messaging product — generates the metric every customer asks for ("what's your CSAT?"). Needs a public response page (no auth) and aggregation, but it's bounded scope.
- **MMS:** the App Storage skill exists in this repo, so the storage half is no longer a blocker. The remaining decision is still stub vs real Twilio media URLs.
- **Group messaging:** correctly flagged as the biggest data-model change. Keep deferred — it touches the conversation/message model deeply and would compete with anything else in the same session.

---

## Next session — APPROVED

**Pull Surveys (item 6) off the deferred list before starting anything brand new.** It closes out the original "advanced inbox" vision and gives tenants the one analytics number they always ask for. MMS and group messaging each deserve their own dedicated session and aren't blocking anyone today.

### Suggested follow-on order after Surveys

1. Surveys (CSAT/NPS) — this session
2. Dispositions analytics breakdown (small, ~30 min)
3. URL-synced inbox filters (small, ~30 min)
4. MMS (own session)
5. Group messaging (own session, biggest scope)
