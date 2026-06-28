---
name: brand-safety rebrand guardrail
description: how/where competitor names (e.g. "TextLine") get rewritten to the canonical brand ("Textitie") across AI replies and curated knowledge
---

# Brand-safety rebrand guardrail

Competitor names must never reach a customer or the closed-book knowledge the
AI grounds on. Scrubbing is a pure, idempotent, env-configurable rewrite
(`@workspace/brand-safety` → `rebrandText`; brand = `SAMA_BRAND_NAME`,
competitors = `SAMA_COMPETITOR_NAMES` csv). Layers: (1) runtime AI text, (2)
knowledge ingestion + Classroom publish, (3) LLM prompts, (4) leak logging via
`rebrandAndLog`.

## The Classroom must be scrubbed TWICE in one publish
`publishClassroomSnapshot` scrubs `factsToPublish` BEFORE `adjudicateForPush`
**and** scrubs the adjudicated `verdict.publish` AGAIN before insert.
**Why:** the Librarian (LLM) can emit a brand-new `mergedStatement` that
reintroduces a competitor name after the input-side scrub — an output-only or
input-only scrub leaves a deterministic hole. Recompute `tokenCount` when the
statement actually changes.
**How to apply:** any new write path into `classroom_facts`/`absorbed_facts`,
or any new LLM step that rewrites curated text, needs its own scrub. Re-pushing
a Classroom self-heals existing rows — that is the only clean path for prod,
which the agent can only read.

## AI auto-sends are scrubbed; human sends are not
`sendConversationReply({ scrubBrand: true })` is a guaranteed backstop on the
Auto-Pilot auto-send path (covers grounded answer + holding/stepdown phrases).
Human sends default `scrubBrand:false`.
**Why:** never override an agent's deliberate wording; only the autonomous
paths need the safety net. Co-Pilot drafts/whispers are scrubbed at compose
time so the human sees clean text before sending.

## Per-tenant EXTRA competitor names must be threaded into EVERY scrub site
A per-tenant CSV (`tenants.competitorNamesExtra`) layers on the env base list
for tenants who migrated from some other competitor. The engine merges
base+extra case-insensitively; the server caches the parsed extras ~60s and
invalidates on the Conductor PATCH.
**Why:** a tenant-specific name is only caught if it is in scope AT THAT SITE —
a single scrub call that forgets the extras is a silent tenant-specific leak.
**How to apply:** any NEW scrub call (`rebrandText`/`rebrandAndLog`) must read
the tenant extras and pass them — inbound AI pipeline, outbound ai_reply
backstop, Classroom publish, Brain/knowledge ingestion, and extractFacts all do.

## Leak feed records ONLY at customer-reaching gates; best-effort, NOT metrics-grade
`rebrandAndLog` persists a `brand_safety_events` row on (replacements>0 ||
residue) when the tenant is known, ONLY for surface=`ai_reply` and
surface=`knowledge` (Classroom publish). Ingestion paths (Brain/knowledge/
extractFacts) scrub but DON'T record (not customer-reaching). The write is
fire-and-forget (never throws); the FK cascades on tenant delete (like
`audit_logs`); `detail` is a machine sub-site label only — never raw customer
text (PII).
**Why:** the feed answers "which tenants keep naming a competitor", an
operational signal — it is NOT idempotent (carrier retries/reprocessing can
duplicate rows; Auto-Pilot records at compose time, before a later compliance
suppress could drop the send).
**How to apply:** if the counts ever need to be authoritative, add an event key
and record only after a confirmed send.
