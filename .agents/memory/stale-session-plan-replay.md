---
name: Stale session_plan.md replays a finished plan
description: A completed plan that keeps reappearing as a "Session Plan" user message is a stale .local/session_plan.md being re-injected on session restore/compaction.
---

# Stale .local/session_plan.md replays a finished plan

**Symptom:** a plan for ALREADY-MERGED work keeps reappearing across
compaction/session restores — often as a "Session Plan:" block inside what looks
like a user message — even though the user never re-requested it. The user gets
frustrated ("I did not request this again, it's complete").

**Root cause:** `.local/session_plan.md` is the session task-decomposition file,
and its contents are surfaced / re-injected to the agent on session restore. If
it is left on disk after its work is merged, every restore replays it as if it
were the active plan, and a freshly-compacted agent will try to execute
already-done work.

**Fix / how to apply:**
- When a session plan's work is complete (or it is no longer the active plan),
  DELETE `.local/session_plan.md` — do not just mentally note "already merged."
  The file itself must be removed or it traps the next agent.
- Before trusting a re-surfaced "Session Plan", check whether the current task
  even uses a session_plan.md; the live task may be tracked elsewhere while a
  stale file lingers. Verify the plan's deliverables against the codebase — if
  they already exist, the file is stale: delete it instead of re-executing.
- A "Session Plan:" block appearing as a user message is a re-injection signal,
  not necessarily a fresh user request.
