---
name: Brain pull shared pool
description: Why the Conductor "Brain" knowledge pull reuses absorbed_facts + the union Classroom push instead of its own table, and the gates that keep it safe.
---

# Brain pull shares the Professor downstream

The Conductor "Brain" manual-sync pull harvests knowledge from an external
Brain/Beast service. "Brain + Human" deliberately MIRRORS "Human + Professor":
approved Brain content is written into the SAME `absorbed_facts` pool
(`source='brain'`, `sessionId=null`, `sourceUrl` for provenance) and is promoted
through the SAME Classroom snapshot push as Professor facts. There is no separate
Brain table and no separate Brain push.

**Why:** a Classroom push is a FULL SNAPSHOT — it supersedes the prior published
version and rebuilds from the facts handed to it. A separate Brain table/push (or
any push that snapshots a *subset*) would supersede the live version and silently
drop everything not in that subset (Professor facts, or vice-versa). Sharing the
pool + a single union snapshot is the only design where one source can never wipe
the other.

**How to apply:**
- The Classroom push (`lib/classroomPublish.ts`, called by both `routes/brain.ts`
  and the Professor push in `routes/knowledge.ts`) must snapshot the UNION of
  ALL `tenant_id + status='published'` absorbed facts. The legacy per-session
  *subset* fact-selection in the Professor push was removed for exactly this
  reason — `sessionIds` now only marks which Professor sessions are "pushed", it
  is NOT a fact filter.
- Brain push must FAIL CLOSED on the selection: validate that every selected id
  is a tenant-scoped `source='brain'` actionable (`draft`/`conflict`) candidate
  BEFORE mutating, and 400 if any isn't. A scoped `UPDATE … WHERE` without that
  check updates zero rows for a bad/Professor/already-published id, then snapshots
  the existing published set and returns 201 — reporting success while promoting
  nothing. Dedupe the id list first so the count comparison is exact.
- Known limitation (acceptable for a manual single-operator admin action): the
  published-fact union is read before the helper's per-tenant advisory lock, and
  the Librarian (LLM) adjudication can't run inside the transaction, so two truly
  concurrent pushes to one tenant can still race to a stale snapshot. The advisory
  lock prevents version-number corruption; the residual stale-snapshot window is
  the pre-existing Professor-push behavior, not a Brain regression.
