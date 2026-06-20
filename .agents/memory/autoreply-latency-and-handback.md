---
name: Auto-reply latency & silent handback
description: Why ungrounded inbound questions are slow and why "sensitive" topics get no customer reply in Auto-Pilot
---

# Auto-reply latency & the "dropped second message"

Two distinct problems, often mistaken for "the second of two rapid questions gets dropped."

## 1. Latency on ungrounded questions — the "minutes" claim was WRONG
- A customer question that isn't in the tenant Classroom/KB makes the fast Student draft `!kbMatched`.
- `evaluateAutoSend` requires `kbMatched` + `groundedInClassroom` + grounding facts, so the Student's draft can **never** auto-send for an unknown question; the only auto-sendable answer comes from the **Professor escalation** (`PROFESSOR_MODEL` = `grok-4.3`, a reasoning model).
- **CORRECTION (verified against prod logs 2026-06-20):** the escalation is NOT "tens of seconds to minutes." Measured: Student ~600ms, Professor escalation ~5s. The old "minutes" figure here was never measured and is disproven. Do **not** diagnose draft-not-appearing as model latency — see the real cause in `inbox-realtime-draft-refresh.md`.
- **Lesson (still valid as a design preference, not a measured pain):** keep live customer replies off the reasoning Professor where you can; reasoning is for *learning* (fact curation). Decouple answer-fast from learn-in-background. But this is about throughput at scale, not the "first response shows on the second question" symptom — that one was a missing realtime event, not slowness.

## 2. The "dropped" message is the safety gate ghosting sensitive topics
- It is **not** the escalation throttle. `claimEscalationSlot` is keyed `tenantId:normalizedQuestionText` — two *different* questions get different keys and never collide. It only caps repeats of the *same* question (5-min TTL).
- The real cause: `RISKY_QUERY_CATEGORIES = {pricing, compliance, technical_setup}` and `SAFE_AUTO_CATEGORIES = {general, features}`. In Auto-Pilot both `evaluateAutoSend` and `evaluateProfessorEscalationSend` **fail-closed** on a risky inbound intent or a non-safe escalated-fact category → Blue handback.
- A Blue handback in Auto-Pilot sends the customer **nothing** — no acknowledgment. With no agent watching the inbox at scale, the customer is silently ghosted.
- `classifyQueryCategory`: "opt in/opt out/consent/unsubscribe/privacy/hipaa…" → `compliance`; "setup/install/api/integrate/registry-ish setup" → `technical_setup`. So "SMS opt in" → compliance (blocked); "campaign registry" → Professor tags facts compliance/technical_setup → `unsafe_escalated_category` (blocked). "what is SMS" / "platform to manage customers" → features/general → sent.
- The "first vs second" pattern is coincidence: the *safe* question happened to come first, the *sensitive* one second, in both rounds.
- **Lesson:** if sensitive topics stay human-gated, the customer must still get an instant acknowledgment so they are never silently dropped.
