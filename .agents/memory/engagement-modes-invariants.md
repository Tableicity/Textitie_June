---
name: Engagement-mode invariants (manual/copilot/autopilot)
description: Cross-file invariants for the three engagement modes — alias normalization on every write path, the learning rule, and the human-send → AI-state coupling.
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

## The learning rule is the single invariant that ties the whole pipeline together
Persist Professor facts to the Library **IFF the AI reply was sent autonomously AND unedited**
(an `autopilot` confirmed send). ANY human touch — `copilot` draft, Auto-Pilot→Blue handback, or a
human step-in — **never learns**. **Why:** edited/human text isn't model-attested truth and would
poison the self-learning loop. **How to apply:** keep fact *screening* split from fact *persistence*
in `knowledge.ts`; only call persist after the send is confirmed on the autopilot path.

## Human send must hand the conversation back to green
A human send marks the pending `drafted`/`refused`/`failed` `conversation_ai_states` row
`human_handled` (never `auto_sent`). **Why:** without this an `autopilot` conversation's send button
stays stuck on the Blue/handback color after a human steps in. The detail query must be invalidated
on send success (not only via SSE) or the button/reason-chip can appear stale until reload.
