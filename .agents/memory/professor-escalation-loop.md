---
name: Professor live-escalation self-learning loop
description: How ungrounded inbound SMS escalate to the autonomous Professor, auto-persist facts as truth, and why customer text is never trusted.
---

# Professor live-escalation / self-learning loop

When an inbound Student draft is **ungrounded** (`!kbMatched`) the webhook escalates to an
autonomous Professor (OpenRouter/Qwen, `qwen/qwen3-max`) that answers from the tenant Library + its own expertise and
returns strict JSON (2-3 atomic categorized facts + a customer reply + 3 engagement questions +
confidence). Clean facts are auto-persisted into the current Classroom version as **provisional
truth** (see "PROVISIONAL" section below) so the system never asks the same thing twice; under
`autopilot` it may auto-send the reply, `copilot` whispers/drafts it, `manual` skips AI entirely.
(Modes are canonical `manual | copilot | autopilot`; legacy `gated_auto`→`autopilot`,
`assisted`→`copilot`, aliased on write.)

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
`autopilot` only) additionally requires: only SAFE categories (`general`/`features` — pricing,
compliance, technical_setup always whisper), high confidence, ≥1 fact **persistable** (screened,
not merely model-returned), no unresolved conflict, telephony compliance OK, automation didn't
already handle it, AND the **independent
inbound query intent is not risky** (a risky inbound intent blocks the send even if the Professor
labeled its facts benign — the fact classifier can under-tag).

## Self-learned facts are PROVISIONAL, not permanent (review-queue hardening)
An architect review flagged that auto-persisting escalated facts as plain `published` lets a single
bad self-learned fact become permanent truth silently. The hardening: at persist time the escalated
survivors split into
- **clean** → written to `classroom_facts` (groundable now) AND mirrored to `absorbed_facts` with
  status **`auto_published`** (provisional-but-live: grounds + auto-sends exactly like `published`,
  because grounding reads `classroom_facts` which has NO status column, and the auto-send gate never
  reads fact status), surfaced for a later human review queue;
- **flagged** (`flagEscalationConflict`: trigram Jaccard sim to an existing classroom fact in the
  `[0.3, 0.5)` band — `[CONFLICT_SIM, DEDUPE_SIM)` — or overlaps a *different-category* fact) →
  written ONLY to `absorbed_facts` as status **`conflict`** with a `conflictReason`, NEVER to
  `classroom_facts`, so it can't ground and it fail-closes auto-send for its category via
  `hasUnresolvedConflicts`.

**Why:** statuses on these knowledge columns are free-form text by design (project hard-rule: no DB
CHECK/enum — one bad row else 500s the list endpoint), so adding `auto_published` needs **no
DDL/migration**.

## Invariant: every "live truth" status must move in LOCKSTEP
There is now MORE than one active-truth status (`published` AND `auto_published`). Any code that
reasons over "current truth" must treat them as a **set**, not just `published`. The review caught a
real bug: the push-union SELECTs (`routes/knowledge.ts`, `routes/brain.ts`) were widened to
`inArray(status, ['published','auto_published'])`, but the Librarian **conflict-marking UPDATE** in
`classroomPublish.ts` still guarded `eq(status,'published')` — so an `auto_published` fact the
Librarian adjudicated as a conflict on a human/Brain push was a **no-op update**: it stayed
`auto_published`, stayed groundable, and re-entered every future union.
**How to apply:** when you add a live-truth status, grep for BOTH the union SELECTs and the
conflict/supersede UPDATEs and widen them together; add a regression test that pushes with an
`auto_published` fact forced into `verdict.conflicts` and asserts it ends up `conflict` + absent from
the new published version.

## The `conflict` status is SHARED by three producers — filter by provenance, not status
`absorbed_facts.status='conflict'` is emitted by THREE independent flows: live escalation
(`source='professor'` AND `sessionId IS NULL`), Brain pull (`source='brain'`), and human
Professor-session curation (`sessionId` set). Only `auto_published` is unique to escalation.
**Why:** the operator "Auto-Learned Review Queue" first selected `status in (auto_published,conflict)`
with no provenance filter, which would have surfaced Brain candidates and human-session conflicts in
a panel that claims "the Professor learned these autonomously" — and let the operator approve/reject
them through the wrong surface.
**How to apply:** any query meant for ONLY self-learned escalation facts must AND in the provenance
predicate `source='professor' AND sessionId IS NULL` (helper `autoLearnedProvenance()` in
`knowledge.ts`); enforce the IDENTICAL predicate on the list read AND on the approve/reject lookups
so the queue and its actions can never disagree (a fact off-queue must 404, not mutate).

## Concurrency
Live escalation persistence takes the **same advisory lock** as human Classroom pushes
(`pg_advisory_xact_lock(tenantId, CLASSROOM_PUSH_LOCK=0)`), reads/creates the current published
version under the lock, re-runs dedup inside the lock, then appends facts + bumps version counts in
one transaction. **Why:** without the shared lock, a concurrent human push and a live escalation
could fork the published version or double-insert near-duplicate facts.
