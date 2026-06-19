---
name: Professor live-escalation self-learning loop
description: How ungrounded inbound SMS escalate to the autonomous Professor, auto-persist facts as truth, and why customer text is never trusted.
---

# Professor live-escalation / self-learning loop

When an inbound Student draft is **ungrounded** (`!kbMatched`) the webhook escalates to an
autonomous Professor (grok-4.3) that answers from the tenant Library + its own expertise and
returns strict JSON (2-3 atomic categorized facts + a customer reply + 3 engagement questions +
confidence). Facts are auto-persisted as **published truth** into the current Classroom version so
the system never asks the same thing twice; `gated_auto` may auto-send the reply, `assisted`
whispers it.

## Injection safety is deterministic, not provenance-trust
The customer SMS is QUERY-ONLY and must NEVER become a persisted fact. The Professor labels each
fact with a `provenance` (`library` | `general_expertise`), but **that label is self-attested by
the same model that read the untrusted customer text**, so a prompt-injected inbound can ask the
model to emit a customer assertion under a Professor provenance.

**Why:** an architect review FAILed an earlier version precisely because parsing/provenance checks
alone could be subverted by injection → customer-supplied claims could be auto-published as truth.

**How to apply:** before persisting, run the deterministic screen (`screenEscalatedFacts`):
- Drop any fact whose trigram overlap with the customer's inbound text is high (it echoes the
  customer → `factDerivedFromCustomer`). This is the real enforcement of "customer text is never
  truth," independent of the model's label.
- A `library`-provenance fact must actually share salient tokens with the retrieved Library
  context (`factGroundedInLibrary`); an empty Library context means NO fact can be library-grounded.
- Never relax these to "trust the model's provenance" — that is the exact hole that failed review.

## Auto-send gate is stricter than the persistence gate
Persisting a fact ≠ allowed to auto-send it. `evaluateProfessorEscalationSend` (fail-closed,
`gated_auto` only) additionally requires: only SAFE categories (`general`/`features` — pricing,
compliance, technical_setup always whisper), high confidence, ≥1 fact persisted, no unresolved
conflict, telephony compliance OK, automation didn't already handle it, AND the **independent
inbound query intent is not risky** (a risky inbound intent blocks the send even if the Professor
labeled its facts benign — the fact classifier can under-tag).

## Concurrency
Live escalation persistence takes the **same advisory lock** as human Classroom pushes
(`pg_advisory_xact_lock(tenantId, CLASSROOM_PUSH_LOCK=0)`), reads/creates the current published
version under the lock, re-runs dedup inside the lock, then appends facts + bumps version counts in
one transaction. **Why:** without the shared lock, a concurrent human push and a live escalation
could fork the published version or double-insert near-duplicate facts.
