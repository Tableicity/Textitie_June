---
name: Inbound AI staging FIFO + worker error contract
description: Durable per-conversation FIFO queue that serializes the inbound AI pipeline; the swallow-vs-rethrow rule that keeps its retry path alive.
---

# Inbound AI staging queue + per-conversation FIFO worker

The inbound AI pipeline (Student draft / Co-Pilot / Auto-Pilot gate+send /
Professor escalation) runs OFF a durable staging queue
(`conversation_inbound_ai_stages`), polled by a FIFO worker, not in-process on the
webhook. This replaced the old in-process `claimEscalationSlot` lock.

## Serialization invariant
At most ONE inbound per conversation is in flight: claim is a single
`UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)` that also
excludes conversations already `processing`, backstopped by a PARTIAL UNIQUE INDEX
(one `processing` row per `conversation_id`). Different conversations run in
parallel. A unique-violation on claim = "nothing claimed this round" (swallow).

## Smart burst-coalescing
enqueue debounces (`available_at = received_at + COALESCE_WINDOW_MS`, default 6s)
so a rapid follow-up can land and be merged. The worker walks queued follow-ups by
arrival order, including each whose gap from the PREVIOUS member is within the
window, breaking at the first larger gap. It runs the pipeline ONCE with the
NEWEST member's message id / SID / from (active-turn authority → composer + the
`ai_auto_replies` idempotency key anchor on the newest) and a combined body joined
in arrival order. The combined body is QUERY-ONLY — never persisted as truth.

## The error contract that makes retry actually work (non-obvious)
**A worker-wrapped pipeline MUST RE-THROW unexpected errors so the worker can
requeue/dead-letter the whole burst.** If the pipeline's top-level catch logs and
RETURNS (swallows), the worker reaches its "finalize → done" line on every run and
the requeue/backoff path is permanently dead — failures masquerade as success and
the inbound is lost with no retry.

**Why:** the whole point of the durable queue is at-least-once processing with
backoff; a swallow-and-return pipeline silently downgrades it to at-most-once.

**How to apply:**
- EXPECTED outcomes (stub fallback, gate refusal, send failure) are handled inline
  with a Blue handback and RETURN normally → worker finalizes `done`. Correct.
- Only genuinely UNEXPECTED errors (DB drop mid-pipeline, bugs) should reach the
  top-level catch → log + RE-THROW → worker `failCoalescedBurst` (requeue same
  `available_at` so the retry re-coalesces the identical set, or dead-letter at the
  attempt cap).
- Whole-burst fail/finalize must be ONE transaction over anchor + all follow-up
  ids, and the follow-up id list must be captured BEFORE the try so a gather-time
  failure still fails the whole set together (never orphan a follow-up to be
  re-claimed as its own re-anchored turn).
- Crash recovery: a stale-`processing` reclaimer (visibility timeout) re-queues
  rows whose worker died; bound external calls so a hang can't outlive the timeout
  and get double-processed.
