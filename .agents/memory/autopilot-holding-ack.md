---
name: Auto-Pilot graceful handback (holding ack)
description: Why/how Auto-Pilot auto-sends a verbatim stall phrase on refuse/fail without ever clearing the Blue handback.
---

# Auto-Pilot graceful handback — holding ack

When Auto-Pilot's fail-closed gate REFUSES (status `refused`) or the Student draft
FAILS (`grok_error`, status `failed`), the pipeline may auto-send a tenant-approved,
human-written HOLDING phrase verbatim — an *acknowledgment to the customer*, NOT an
answer — and then KEEP the Blue handback so a human still owns the real reply.

**Rule:** the ack is purely a customer stall. It NEVER flips the handback status; the
state stays `refused`/`failed` (Blue), the AI's real draft is preserved in `draftBody`
for the human, and the chip reads `"Acknowledged — needs your reply"`. This path NEVER
learns (no `persistEscalatedFacts`).

**Why:** silent handback leaves the customer with dead air while a human catches up.
A verbatim, tenant-owned stall is safe (no AI-authored answer can be wrong), but it
must not pretend the question is resolved — hence status stays Blue and a human is
still required.

**How to apply (the non-obvious invariants):**
- **Opt-in / fail-safe:** `tenants.autopilotHoldingPhrase` (nullable text, NO DB CHECK).
  Empty/whitespace ⇒ today's silent Blue handback. Never invent a default phrase.
- **Two-layer dedup, distinct purposes:**
  - *Throttle* (≤1 ack per waiting episode) = the PRIMARY guard. Keyed on
    `conversation_ai_states.handbackAckSentAt`: if prior state is `refused`/`failed`
    AND the marker is set, carry-forward and send nothing. The episode ends when a
    human replies (`human_handled`) or the state is superseded — both CLEAR the marker
    (`handbackAckMessageId` + `handbackAckSentAt`).
  - *Claim* (`ai_auto_replies`, key = `inboundSid ?? msg:<inboundMessageId>`) = the
    SECONDARY idempotency guard for webhook retries/concurrency. Must RELEASE (delete)
    the claim on any send failure (returned `ok:false` OR thrown) so a retry can re-ack.
- **Compliance re-checked at SEND time** (`checkOutboundCompliance`, fail-closed). A
  block ⇒ release claim, stay silent. The ack is a real outbound SMS.
- **Best-effort:** the helper never throws past the pipeline contract; any failure
  degrades to a plain silent Blue handback with no ack marker.
- Auto-Pilot ONLY. Co-Pilot (see `fallback-phrase-copilot.md`) and Manual are untouched.

Single chokepoint: `maybeHandbackWithHoldingAck(...)` in `inboundAiPipeline.ts`, called
from both the grok_error branch and the gate-refused branch (replaced their inline
ai-state upserts). Throttle/idempotency cols are INTERNAL — not exposed in the aiState API.
