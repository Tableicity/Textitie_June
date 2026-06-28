---
name: Reminder grey-bell vanish = dismiss trap
description: Why a "scheduled reminder's grey bell disappears on its own" report is never a timer, and the two-tier removal rule that fixes it.
---

# Reminder grey bell "disappears on its own"

When a user reports a SCHEDULED (not-yet-due) reminder's grey bell appearing then
vanishing "after a few seconds," it is **not** a timer/effect auto-removing it.
The bell is gone because the reminder got **dismissed** (`reminders.dismissed_at`
set). Diagnostic that proves it: a dismissed-while-scheduled row has
`dismissed_at` SET but `fired_at` NULL (the due-timer `processDueReminders` only
ever sets `fired_at` first), and prod request logs show each disappearance lines
up exactly with a `PATCH /api/reminders/:id/dismiss`. The only client caller of
dismiss is the per-row ✕ button.

**Root trap:** with a single reminder in the popover, the per-row ✕ renders in the
top-right — exactly where a "close this panel" ✕ would be — so users click it to
close the popover and silently soft-delete a future reminder.

## Rule: reminder removal is intentionally two-tier
- **Due/overdue** reminder → ✕ = one-click dismiss (clearing an active alert is
  expected; keep it instant).
- **Scheduled (not-due)** reminder → ✕ opens an inline two-step confirm
  (Remove / Cancel); the first click is local-only and fires **no** network
  dismiss. Gate in `ReminderRemoveButton`; due-ness is `isReminderDue(r)` in the
  conversation popover and `tone === "overdue"` in the header hub (the `dueToday`
  bucket means "scheduled later today" and stays protected).

**Why:** dismissing a future reminder is almost never intended; the persistent
grey bell is a deliberate cue the agent set. A one-click close-looking ✕ that
deletes it is data loss.

**How to apply:** do NOT "simplify" scheduled removal back to one-click, and do
not add a DB/timer path that clears scheduled reminders — both reintroduce the
vanishing-bell bug. The grey/red bell itself already persists until dismiss;
protect the dismiss affordance, not the render.

**Composer card has NO ✕ at all** (`ConversationReminderPopover showRemove={false}`
only on the composer toolbar instance): there the ✕ reads like a "close panel"
button and is pure friction, so removal lives on the left-pane row bell + header
hub instead. Do NOT re-add the ✕ to the composer card "for consistency."
