# Reminders — Build Plan (Composer-first, conversation-scoped)

**Status:** Phases 1–3 approved for build (2026-06-28). Phase 4 parked here so we
don't forget it.
**Where:** `artifacts/user-app` (tenant Inbox) + `artifacts/api-server`
(reminders API) + `lib/db` (reminders table) + `lib/api-spec` (OpenAPI).

---

## The vision (user's words, distilled)

The composer area (Co-Pilot pill, Internal Note, Attach, Emoji) is the
high-value user→customer engagement zone. A paying agent who needs a reminder
mid-conversation would look for it **as an icon in the composer toolbar**. The
reminder should be **tied to the conversation / phone number** being answered,
with a **bell on that conversation's row in the left pane** so it isn't
forgotten. Clicking the composer icon **or** the row bell opens a **card** with
the reminder features (why it was set, when it's due, manage it). Plus an
**"All Reminders"** view to plan the day.

## What already exists (foundation — ~70% there)

- **DB:** `reminders` table — `tenant_id`, `conversation_id`, `user_id`,
  `remind_at`, `note`, `fired_at`, `dismissed_at`, `created_at` (per-user,
  per-conversation; timestamptz). `lib/db/src/schema/reminders.ts`.
- **API:** `routes/reminders.ts` — `GET /reminders?status=due|pending|all`,
  `POST /reminders`, `PATCH /reminders/:id/dismiss`, `DELETE /reminders/:id`,
  and `processDueReminders()` (stamps `fired_at`).
- **Timer:** `timerEngine.ts` polls every 60s and fires due reminders.
- **UI:** `ReminderBell.tsx` (header popover listing **due** reminders; jump +
  dismiss; 30s poll). A rich **create card** (date/time + presets +15m/+1h/+4h/
  Tomorrow 9am + note) exists inside `Inbox.tsx` but is **orphaned** — its
  trigger button was removed, so nothing opens it today.

Gap to close: a creation entry point, plus **edit** and **snooze** (today you
can only dismiss/delete), plus surfacing **pending** reminders (the header bell
only shows items after the 60s timer marks them due).

---

## Phase 1 — Composer icon → conversation reminder card (+ edit + snooze)

- Add a **reminder icon** to the composer toolbar (beside Co-Pilot / Note /
  Attach / Emoji). Auto-scoped to the open conversation (`selectedId`), so the
  reminder is inherently tied to that customer thread.
- Clicking it opens a **conversation reminder card** that:
  - lists this conversation's active reminders (note + due time + state),
  - has an inline create form (the existing presets + note),
  - per reminder: **edit** (time/note), **snooze** (push out + re-arm),
    **dismiss**.
- **Backend additions:** a general `PATCH /reminders/:id` that accepts
  `remindAt` and/or `note`; when `remindAt` moves to the future it **clears
  `fired_at`** (this is snooze). Tenant + user scoped, validates future time,
  conversation ownership. Add to OpenAPI (verb-first operationId, e.g.
  `updateReminder`) → `pnpm --filter @workspace/api-spec run codegen`.
- Retire the orphaned create dialog (fold its form into the shared card).

## Phase 2 — Left-pane per-conversation bell

- Render a small **bell on conversation rows** that have an active reminder:
  - *outline bell* = reminder **scheduled** (pending / future),
  - *filled or red bell* = reminder **due now**.
- Click the bell → opens the **same** conversation reminder card from Phase 1
  (DRY). Stop propagation so it doesn't just select the row.
- **Data:** fetch the agent's active reminders once (`GET /reminders?status=all`)
  and map by `conversationId` → `{ hasPending, hasDue }` on the client (no
  conversations-list API change). Fine at this scale (per-user, capped at 100).
  If it ever needs to scale, promote to a `reminderState` field on the
  conversations list response.
- This also fixes the "pending is invisible" gap — the bell reads pending
  directly instead of waiting for the 60s timer.

## Phase 3 — "All Reminders" hub (plan the day)

- Upgrade the header bell into the global hub: read `status=all` and group
  **Overdue / Due today / Upcoming**, sorted by time, each row with jump +
  edit + snooze + dismiss.
- Header badge stays "**due** count" (notification semantics). The popover (or
  a dedicated panel) becomes the planning surface so we don't end up with 4
  overlapping entry points: composer = create, row bell = per-thread context,
  header bell = global hub.

---

## Phase 4 — PARKED (do NOT forget) — proactive notifications & power features

Not in the current build. Captured so it isn't lost:

1. **Snooze-from-fire toast:** when a reminder comes due while the agent is in
   the app, show a toast with quick snooze (1h / tomorrow) + jump, not just a
   silent badge bump.
2. **Offline notifications:** email and/or SMS nudge to the *agent* for
   reminders that fire while they're logged out. Hook off `processDueReminders`
   (it already stamps `fired_at`). NOTE: agent-SMS has carrier cost + 10DLC
   compliance considerations — design before enabling.
3. **Recurring reminders:** "every Monday 9am" style. Needs a recurrence field
   + the timer to re-arm on fire. Over-engineering for v1; revisit on demand.
4. **Team assignment / shared reminders:** today reminders are **private to the
   agent** who set them. Decide later whether a reminder can be set *for* a
   teammate or should follow conversation assignment (changes who sees the
   left-pane bell). Schema impact — decide before building.
5. **Calendar / day-planner export:** "All Reminders" → iCal feed or a
   day/agenda view for planning beyond the inbox.

---

## Cross-cutting conventions (repo rules)
- Contract-first: edit `lib/api-spec/openapi.yaml`, then
  `pnpm --filter @workspace/api-spec run codegen`. **Verb-first operationIds**
  (avoid Orval symbol mangling).
- Server: never `console.log` — use `req.log` / `logger`.
- Tenant routes use `requireTenantAuth`; everything tenant + user scoped.
- Typecheck: `pnpm --filter @workspace/user-app run typecheck` and
  `pnpm --filter @workspace/api-server run typecheck`.
- No DB CHECK/enum on free-form columns (raw-row endpoints 500 on a bad row).
