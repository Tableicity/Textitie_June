---
name: Auto-reply latency & silent handback
description: Why ungrounded inbound questions are slow and why "sensitive" topics get no customer reply in Auto-Pilot
---

# Auto-reply latency & the "dropped second message"

Two distinct problems, often mistaken for "the second of two rapid questions gets dropped."

## 1. Latency (minutes) on ungrounded questions
- A customer question that isn't in the tenant Classroom/KB makes the fast Student draft `!kbMatched`.
- `evaluateAutoSend` requires `kbMatched` + `groundedInClassroom` + grounding facts, so the Student's draft can **never** auto-send for an unknown question.
- The only auto-sendable answer then comes from the **Professor escalation**, which runs `PROFESSOR_MODEL` = `grok-4.3`, a **reasoning** model, *on the customer-reply path*. Reasoning + JSON extraction (facts + reply + 3 questions) = tens of seconds to minutes.
- **Lesson:** real-time customer replies must not depend on the reasoning Professor. The reasoning model is for *learning* (fact curation), not for answering live. Decouple: answer fast, learn in the background.

## 2. The "dropped" message is the safety gate ghosting sensitive topics
- It is **not** the escalation throttle. `claimEscalationSlot` is keyed `tenantId:normalizedQuestionText` — two *different* questions get different keys and never collide. It only caps repeats of the *same* question (5-min TTL).
- The real cause: `RISKY_QUERY_CATEGORIES = {pricing, compliance, technical_setup}` and `SAFE_AUTO_CATEGORIES = {general, features}`. In Auto-Pilot both `evaluateAutoSend` and `evaluateProfessorEscalationSend` **fail-closed** on a risky inbound intent or a non-safe escalated-fact category → Blue handback.
- A Blue handback in Auto-Pilot sends the customer **nothing** — no acknowledgment. With no agent watching the inbox at scale, the customer is silently ghosted.
- `classifyQueryCategory`: "opt in/opt out/consent/unsubscribe/privacy/hipaa…" → `compliance`; "setup/install/api/integrate/registry-ish setup" → `technical_setup`. So "SMS opt in" → compliance (blocked); "campaign registry" → Professor tags facts compliance/technical_setup → `unsafe_escalated_category` (blocked). "what is SMS" / "platform to manage customers" → features/general → sent.
- The "first vs second" pattern is coincidence: the *safe* question happened to come first, the *sensitive* one second, in both rounds.
- **Lesson:** if sensitive topics stay human-gated, the customer must still get an instant acknowledgment so they are never silently dropped.
