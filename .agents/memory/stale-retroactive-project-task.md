---
name: Stale retroactive project task
description: Why creating a project task for already-shipped Build-mode work backfires, and how close-out binds to the last assigned task.
---

Do NOT create a project task to retroactively "capture" work that was already
built and merged in Build mode. It becomes a permanent stale Draft: a project
task's lifecycle is Draft→Active→Ready→Merged, and there is no implementation
phase left for already-shipped code, so it can never legitimately flow to Merged
through the normal path.

The close-out/validation step binds its automatic code review to the LAST
assigned project task. If that last assignment is a terminal MERGED task and you
then do untracked Build-mode work, every finalize attempt fails two ways:
(1) the review judges your unrelated diff against the old task's spec →
scope-mismatch rejection, and (2) "cannot report done from state MERGED".
Compaction re-surfaces the stale task each time from the saved task ledger + the
on-disk `.local/tasks/*.md` plan files, so it recurs after every compression.

**Why:** shipping real code with no owning task never advances the assignment
pointer; the pointer stays on the last thing that WAS tracked.

**How to apply:**
- For small ad-hoc Build-mode fixes, just ship — do not run the formal
  close-out, and do not mint a duplicate task for them.
- If the pointer is genuinely stuck on a terminal task and a clean close is
  required, get a NEW correctly-scoped task assigned as the ACTIVE task, then
  close it. When the code already exists, mark complete with a drift_reason and
  skip_validation_reason (no new changed surface) rather than manufacturing a
  diff.
- Sibling case (the session-plan variant) is in stale-session-plan-replay.md.
