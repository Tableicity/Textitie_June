---
name: Co-Pilot fallback phrase
description: Why the per-tenant fallback phrase deliberately pre-empts Professor escalation in Co-Pilot.
---

# Co-Pilot fallback phrase pre-empts escalation

A per-tenant free-text `tenants.fallbackPhrase` (mirrors `brandScope`: same PATCH allow-list, no server-side length cap — the admin textarea cap is cosmetic, kept symmetric on purpose).

In `inboundAiPipeline.ts`, when the effective mode is `copilot` AND the phrase is non-empty AND the inbound is **ungrounded** (`!draft.kbMatched && !strongClassroomMatch`, where `strongClassroomMatch = classroomMatch === "fts"`), the pipeline stages the phrase **verbatim** as the Co-Pilot draft (`draftSource: "fallback_phrase"`) and **returns early — deliberately skipping Professor escalation**.

**Why:** the product intent is "do not guess" on tenant-specific / ungrounded inbounds. A human-authored holding phrase is preferred over an escalated AI guess in Co-Pilot, so the fallback intentionally short-circuits the escalation path rather than supplementing it.

**How to apply:**
- The block sits AFTER the Student draft (so `kbMatched` is populated) and BEFORE escalation. Keep that ordering.
- It is **Co-Pilot only**: Manual returns earlier; Auto-Pilot falls through the existing else branch and must stay byte-for-byte unchanged (it only pays the harmless cost of computing the phrase/ungrounded locals).
- **Fail-open**: empty/whitespace phrase falls through to the existing Student/Professor path.
- The staged async draft must publish its OWN `ai:state` realtime event (it's written after the inbound's own event), or the polling-less inbox detail stays stale — see inbox-realtime-draft-refresh.
