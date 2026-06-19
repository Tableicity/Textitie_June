---
name: AI auto-send safety contract
description: Rules for the gated_auto engagement-mode auto-send path — fail-closed gate + the ai_auto_replies claim lifecycle.
---

# AI auto-send (engagement mode `gated_auto`) safety contract

The Student may auto-send an SMS reply ONLY through the pure, fail-closed gate
`evaluateAutoSend` (`artifacts/api-server/src/lib/engagementPolicy.ts`). Keep it a
single AND of independent signals so each can be unit-tested; any unknown/unsafe
input must BLOCK (fall back to the agent whisper).

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
