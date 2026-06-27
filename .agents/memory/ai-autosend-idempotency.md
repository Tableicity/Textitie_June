---
name: AI auto-send safety contract
description: Rules for the autopilot auto-send path — the fail-OPEN closed-book gate + fallback circuit breaker, and the ai_auto_replies claim lifecycle (release on fail/throw).
---

# AI auto-send (engagement mode `autopilot`) safety contract

> Modes are now canonical `manual | copilot | autopilot` (legacy `gated_auto`→`autopilot`,
> `assisted`→`copilot`, aliased on write). Auto-send only ever runs under `autopilot`.

**Auto-Pilot now runs the fail-OPEN closed-book gate `evaluateAutoPilotTurn`** (NOT the old
fail-closed `evaluateAutoSend`, which is retained but off the autopilot path). It still
auto-sends, but a no-match / responder error sends a graceful ack instead of refusing, and a
fallback **circuit breaker** (`autopilot_turn_events`) steps the conversation to `manual` after 3
consecutive / >3-in-2-min fallbacks. The idempotency + compliance rules below are UNCHANGED and
still apply to every autopilot send. **Breaker integrity:** a send that fails or throws must record
NO turn event (only the claim is released) — the breaker advances solely on confirmed sends, so a
delivery outage can never trip a conversation down to Blue.

## Idempotency claim lifecycle (the subtle part)
Before sending, claim the inbound carrier MessageSid by INSERT into
`ai_auto_replies` (unique `(tenant_id, inbound_sid)`, `onConflictDoNothing`).

- **Only a completed send is terminal** = the claim row has a non-null
  `outboundMessageId`. On a claim conflict, treat the inbound as already-handled
  ONLY if the existing row's `outboundMessageId` is non-null.
- **A FAILED send must DELETE the claim.** Otherwise the null-`outboundMessageId`
  row becomes a permanent dead-letter and every webhook retry is silently
  suppressed forever. Deleting is safe because a failed send never reached the
  customer. (This was caught in architect review, not by tests.)
- **A THROWN send is a failed send too.** Releasing the claim only on the
  `{ok:false}` return path is not enough — if the sender (or any step between the
  claim INSERT and recording `outboundMessageId`) THROWS, the same null claim
  leaks. Wrap claim→send→record in try/catch and release on throw. Guard with a
  `claimFinalized` flag set the instant `outboundMessageId` is written (or the
  claim is deleted): a post-send bookkeeping throw must NOT re-release the claim
  (that would re-open a reply that already went to the customer → double-text on
  retry). A send failure (returned OR thrown) is a terminal Blue handback, NOT a
  whole-burst requeue — do not re-throw it past the auto-send block.

**Why:** Twilio re-POSTs the inbound webhook if it doesn't get a fast 2xx, and the
Student runs fire-and-forget, so the same inbound can be processed more than once.
The claim is the only thing preventing a duplicate customer reply — but it must not
also block legitimate retries of a send that never actually went out.

## How to apply
- Never gate auto-send on a precheck alone — compliance is re-checked at send time
  inside `sendConversationReply` (`lib/outboundReply.ts`); the gate's compliance
  input is fail-fast only (TOCTOU).
- Risky inbound INTENT ({pricing, compliance, technical_setup}) blocks regardless
  of how benign the grounding facts look — the fact category classifier under-tags,
  so intent is an independent guard, not a duplicate of the grounding-category check.
- The whole Student + gate + auto-send block lives INSIDE the durable
  fire-and-forget IIFE in `routes/webhooks.ts`, AFTER the automation engine and
  gated on `!result.handled`, so it never replies over an automation/opt-out and
  never blocks the inbound 200.
