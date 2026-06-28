---
name: Co-Pilot turn logging
description: Why per-turn Co-Pilot knowledge-vs-Grok analytics needs its own append-only table, and the grounded-signal gotcha.
---

# Co-Pilot turn logging (answered-by-Knowledge vs raced-to-Grok)

Rule: per-turn Co-Pilot draft history lives in its own append-only table
`copilot_turn_events` (a mirror of `autopilot_turn_events`), NOT in
`conversation_ai_states`.

**Why:** `conversation_ai_states` holds only ONE row per conversation (the LATEST
draft) and is overwritten on every new inbound, so historical per-turn data is
unrecoverable from it. To answer "how many Co-Pilot turns were grounded vs
ungrounded" you must log each turn at draft time going forward.

**Gotcha — capture `grounded` EXPLICITLY, never infer from `draftSource`:** a
`draftSource="student"` draft can be UNGROUNDED. When an inbound is ungrounded
(`!draft.kbMatched && !classroomGrounded`) AND the tenant has no fallback phrase
configured, the pipeline falls through to the main Student path and still labels
it `draftSource="student"`. So the grounded flag at the main site must be
`classroomGrounded || draft.kbMatched`, passed explicitly. The other three
Co-Pilot exits are always ungrounded: `router_decline`, `student_flash`
(general-knowledge flash), `fallback_phrase`.

**How to apply / query:**
- "answered using Knowledge" = `grounded = true`.
- "raced to Grok" = `grounded = false AND draft_source IN ('student','student_flash')`.
- `router_decline` and `fallback_phrase` are their own categories (off-scope /
  canned holding phrase), not "raced to Grok".
- Recording is best-effort (swallows its own errors) and idempotent on
  `(tenant_id, inbound_message_id)` so a carrier retry never double-counts; it
  runs off the inbound 200 path in the FIFO worker.
- `staged` distinguishes turns whose guarded draft actually reached the composer
  (true) from no-ops where a human took the wheel / a newer turn superseded it.

**Auto-Pilot has its own `autopilot_turn_events`** (with breaker semantics) — do
NOT fold Co-Pilot turns into it; keep the two tables separate.
