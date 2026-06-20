---
name: Inbox async-draft realtime refresh
description: Why a Co-Pilot/handback AI draft only appeared in the inbox composer after the NEXT inbound message, and the realtime-event rule that fixes it
---

# Async AI drafts need their own realtime event

## Symptom (do not misdiagnose as latency)
In Co-Pilot (Yellow) mode the Student/Professor draft did not appear in the agent inbox composer until a **second** inbound message arrived ("the second question renders the first response"). It was NOT model slowness — prod showed Student ~600ms, Professor escalation ~5s. I wrongly blamed slow model + autopilot gate twice before finding the real cause.

## Root cause (the durable lesson)
The inbound webhook records the message and publishes a realtime event **immediately**, but the AI draft is written to `conversation_ai_states` **seconds later** inside a fire-and-forget pipeline. The realtime bus had no event for "draft/handback ready," and the inbox conversation-**detail** query (the one carrying `aiState.draftBody`) has **no `refetchInterval`** — only the list + messages queries poll. So the composer only refreshed when the *next* inbound message fired its own event.

**Rule:** any state produced **asynchronously after** the request that triggered it (AI drafts, background enrichment, deferred computation) must emit its **own** realtime/invalidation signal **after the awaited DB write**. Do not assume the triggering request's event will carry it — that event already fired before the async work finished. A query with no polling will otherwise go stale until an unrelated event happens to invalidate it.

**Why:** realtime fan-out events are point-in-time; a later write produces no event unless you publish one. Polling-less detail queries depend entirely on targeted invalidation.

**How to apply:** when adding a new async writer of conversation/AI state, publish a tenant-scoped event from **every** write site (drafted, superseded, failed, refused, send_failed — not just the happy path) and add a matching client listener that invalidates the detail + list queries. The auto-sent path is already covered because it emits an outbound `message:new`.

## Known limitation (pre-existing, not from this fix)
The event bus is a process-local `EventEmitter`. If prod autoscale runs **multiple** API instances, an agent's SSE connection may live on a different instance than the one handling the Twilio webhook, so realtime events (both `message:new` and `ai:state`) can be missed. Fix only when scaling horizontally: move to a shared broker (Redis pub/sub) or add a short `refetchInterval` to the detail query as a safety net.
