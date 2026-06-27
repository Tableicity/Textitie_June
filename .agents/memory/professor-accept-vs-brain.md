---
name: Professor accept vs Brain review semantics
description: Why the Professor absorbed-knowledge card behaves differently from Brain, and the invariant to preserve when touching it.
---

# Professor accept/reject vs Brain candidate review

Operators conflate the two review flows and report the Professor accept "does
nothing" because it doesn't behave like Brain. They are deliberately different:

- **Professor** (`/tenants/:id/professor`): the per-fact ✓/✗ in the
  "Absorbed knowledge" popover is an **immediate commit** — it PATCHes one fact
  `draft → published` (or `rejected`) right away. "Push to Classroom" later
  snapshots **only `published`/`auto_published`** facts, so with 0 accepted it
  correctly 400s "Nothing to publish".
- **Brain** (`/tenants/:id` Brain page): a local **checkbox selection** (no
  server write per click) followed by a single **bulk push**; approved
  candidates then leave the candidates GET (the "bucket empties").

**Invariant — do NOT "fix" the perceived bug by removing/hiding accepted facts
from the Professor list.** Reviewed facts intentionally **stay visible** so the
accept is reversible (the operator can un-accept). The Brain-like "drain" feel
is achieved by *sorting* reviewed facts to the bottom + recoloring (accepted =
green tint, rejected = dimmed) + a per-source "N to review → N reviewed" chip,
**not** by deleting rows.

**Why:** The original complaint wasn't a broken endpoint (accepts were
persisting). The gap was **no optimistic update** — `setFactStatus` waited on a
mutation + refetch before any visible change, so a tiny ✓ recolor appeared only
after the round-trip and felt dead.

**How to apply:** Any change to the absorbed-knowledge card must keep
**optimistic feedback** (cancelQueries → setQueryData flip → row-level rollback
on error → invalidate on settle) and keep reviewed facts present-but-drained.
Keep this consistent with Brain's instant-feedback feel without copying its
remove-on-approve behavior.
