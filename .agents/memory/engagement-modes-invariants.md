---
name: Engagement-mode invariants (manual/copilot/autopilot)
description: Cross-file invariants for the three engagement modes — alias normalization on every write path, the closed-book fail-OPEN Auto-Pilot + circuit breaker, the learning rule (now Co-Pilot-only), and the human-send → AI-state coupling.
---

# Engagement-mode invariants

Canonical modes: `manual | copilot | autopilot` (`lib/engagementPolicy.ts` `ENGAGEMENT_MODES`).
Legacy `assisted`→`copilot`, `gated_auto`→`autopilot` are **aliased on write, no data migration**.
Effective mode = per-conversation override ?? tenant mode (`resolveEffectiveEngagementMode`).

## Normalize aliases on EVERY engagement-mode write path
Tenant-settings PATCH **and** per-conversation override PATCH must both fold legacy aliases →
canonical before persisting. **Why:** an architect review caught the override PATCH rejecting
aliases while tenant-settings accepted them — strict/generated clients and any legacy caller drift
apart and one path 400s on input the other accepts. **How to apply:** when you add ANY new write
that sets an engagement mode (bulk update, import, admin tool), run it through the same alias-fold,
not just the canonical enum check. Override `null` = inherit (must survive the fold untouched).

## Auto-Pilot is closed-book + fail-OPEN (NOT the old fail-closed gated/learning model)
Auto-Pilot was redesigned: it answers ONLY from the approved Classroom index
(`retrieveClassroomFactsWithMatch`) and **NEVER escalates to the Professor, NEVER persists facts,
NEVER learns**. It is **fail-OPEN** — a no-match sends a graceful out-of-scope ack and the
conversation CONTINUES green (it does NOT refuse/handback per message like the old gate did). A
**circuit breaker** (3 *consecutive* fallbacks OR >3 in a rolling 2-min window) sends a final ack and
steps the conversation GREEN→BLUE (`engagementModeOverride='manual'`, not auto-cleared — a human
re-enables). Pure gate `evaluateAutoPilotTurn` + breaker history table `autopilot_turn_events`
(`computeAutoPilotFallbackCounts`); runner `runAutoPilotFailOpenTurn` (`lib/inboundAiPipeline.ts`).
**Why:** the old fail-closed `evaluateAutoSend` + Professor-escalation model ghosted customers on
pricing/compliance/setup topics and self-learned provisional facts; closed-book trades learning for
predictable, never-silent behavior. **How to apply:** the old fail-closed autopilot branch is RETAINED
but DEAD — never re-wire autopilot through `evaluateAutoSend` / `evaluateProfessorEscalationSend`.

## The learning rule (self-learning loop is now Co-Pilot ONLY)
The live Professor escalation → screened fact persistence loop runs for **`copilot` only**; `autopilot`
is closed-book (above) and `manual` skips. No path persists facts off a human-edited send. **Why:**
edited/human text isn't model-attested truth and would poison the Library. **How to apply:** keep fact
*screening* split from *persistence* in `knowledge.ts`; the autopilot path must never reach persist.

## Human send must hand the conversation back to green
A human send marks the pending `drafted`/`refused`/`failed` `conversation_ai_states` row
`human_handled` (never `auto_sent`). **Why:** without this an `autopilot` conversation's send button
stays stuck on the Blue/handback color after a human steps in. The detail query must be invalidated
on send success (not only via SSE) or the button/reason-chip can appear stale until reload.
