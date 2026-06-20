---
name: Co-Pilot streaming draft + AI-state concurrency
description: Why async Co-Pilot AI-state writes must be fenced, and the human_handled turn-stamp invariant that makes the fence correct.
---

# Co-Pilot streaming draft + AI-state concurrency

The Professor escalation reply can stream so Co-Pilot prefills the composer
before the slow fact-reasoning finishes: the prompt JSON puts `customerReply`
FIRST, the escalation streams, and an optional `onCustomerReply` callback fires
once that string closes. **Auto-Pilot passes no callback** — its send gate needs
the screened facts + confidence, so it cannot act early; the "Professor tax" is
intentional. The full-text `parseEscalationResponse` + `screenEscalatedFacts` at
stream end stays AUTHORITATIVE for facts/gate/learning.

## The concurrency invariant (the real lesson)
`conversation_ai_states` is one row per conversation, normally last-write-wins.
But streaming introduces a SECOND, EARLIER async write per turn, so any async
Co-Pilot write must be **fenced** or it will clobber a human takeover or a newer
inbound turn that landed mid-stream. Fence on `latestInboundMessageId` (turn
identity) + `status != 'human_handled'`.

**Why a naive `status != human_handled` guard is wrong:** there is **no
inbound-start reset** in the Co-Pilot path (supersede only runs in the
manual / automation-handled branch). So a previous turn's `human_handled` row
survives into a new turn, and a fresh turn MUST be able to overwrite it.

**The gotcha that makes the fence correct:** `markConversationAiStateHumanHandled`
historically did NOT change `latestInboundMessageId`, so you could not tell a
current-turn takeover from a stale prior-turn one by id. It must STAMP the
turn it answered (`max(messages.id)` for the conversation's inbound messages) so
the guard can block a current-turn takeover while still letting a fresh turn
overwrite a stale prior-turn `human_handled`. It still only flips
HUMAN_TAKEABLE statuses (idle/drafted/refused/failed) — auto_sent is left alone.

**How to apply:** route every async Co-Pilot write through the guarded
insert-or-conditional-update (allow when existing is same/older turn or NULL, and
not a `human_handled` stamped at this-or-newer inbound); only claim the early
draft / publish `ai:state` when the guarded write actually wrote. Never revert a
Co-Pilot path to the unconditional upsert.

**Accepted residual:** a brand-new conversation with no AI-state row where a
human replies before ANY row exists — the human-handled mark is UPDATE-only
(mirrors supersede's "don't create a meaningless row"), so the early INSERT can
still surface a draft. Co-Pilot-only (no auto-send), next inbound supersedes it.
