# Brand Fortress — How Textitie Stays Textitie

**Audience:** Textitie staff — platform operators (**Conductors**) and engineers who own the LLM stack. Useful to any agent who wonders "why did the AI rename that other product?"
**Purpose:** A *granular, do-this-then-that* manual for the **brand-safety guardrails** that guarantee the AI never shows a customer a competitor's product name (e.g. "TextLine") and never lets one slip into the curated knowledge the AI grounds on. It documents exactly **what we built**, **where each layer lives**, **how to operate and tune it**, and **how to verify it**.
**How to use this guide:** Read §2 for the 60-second model, then jump to the layer or task you need. Boxes marked **⚠️ Safety** are hard rules.

> This is a **living operational document**. When the system or a procedure changes, update the relevant section **and** add a row to the [Revision History](#11-revision-history).

---

## Document control (at a glance)

| Field | Value |
|---|---|
| **Document** | `Brand_Fortress.md` |
| **Location** | `John/LLM How To/` |
| **Current version** | **v1.0** |
| **Last updated** | 2026-06-27 |
| **Owner** | Platform / LLM-stack team |
| **Companion docs** | `John/LLM How To/LLM_How_To_Training.md` (operating the AI), `John/LLM Training Manual.md` (concepts), `replit.md` (architecture of record) |
| **Review cadence** | Review every release that touches the LLM stack, knowledge publish, or outbound send path |

---

## Table of contents

1. [Why this exists (the threat)](#1-why-this-exists-the-threat)
2. [The 60-second mental model](#2-the-60-second-mental-model)
3. [The engine — `@workspace/brand-safety`](#3-the-engine--workspacebrand-safety)
4. [Layer 1 — Scrub every customer-facing AI reply](#4-layer-1--scrub-every-customer-facing-ai-reply)
5. [Layer 2 — Scrub knowledge before it can be grounded on](#5-layer-2--scrub-knowledge-before-it-can-be-grounded-on)
6. [Layer 3 — Tell the LLM not to do it in the first place](#6-layer-3--tell-the-llm-not-to-do-it-in-the-first-place)
7. [Layer 4 — Catch and log every leak](#7-layer-4--catch-and-log-every-leak)
8. [How to operate & tune it (Conductor / engineer tasks)](#8-how-to-operate--tune-it-conductor--engineer-tasks)
9. [How to verify it works](#9-how-to-verify-it-works)
10. [Hard safety rules & design decisions](#10-hard-safety-rules--design-decisions)
11. [Revision history](#11-revision-history)

---

## 1. Why this exists (the threat)

Textitie's knowledge can be seeded from material that mentions other products — a migrated TextLine inbox, a pasted help-doc, a Brain pull, or simply an LLM that "helpfully" names the tool it thinks it is. If any of that reaches a customer, **we have advertised a competitor in our own product**, and if it reaches the **Classroom** (the approved knowledge the AI answers from), it becomes self-reinforcing.

A prompt instruction alone is **not** enough — an LLM can ignore it. So brand safety is built as **four independent layers**. Layer 3 *asks* the model to behave; Layers 1, 2, and 4 *guarantee* it deterministically, with code, even when the model misbehaves. Defense in depth: any single layer failing does not breach the fortress.

> **⚠️ Safety:** Treat the deterministic scrub (Layers 1, 2, 4) as the real guarantee. Never weaken a code-level scrub on the assumption that "the prompt already handles it."

---

## 2. The 60-second mental model

- **One canonical brand** (`Textitie`) and a **list of competitor names** (`TextLine`, `TextLines`) are configured by environment variables.
- A single pure function, `rebrandText`, rewrites any competitor name → the canonical brand. It is the one source of truth; every layer calls it.
- **Layer 1 (runtime):** every AI-generated reply and draft is scrubbed on the way out. AI auto-sends get a **second, guaranteed** scrub inside the send function itself.
- **Layer 2 (knowledge):** every fact is scrubbed as it is ingested **and** again when it is published to the Classroom — because the conflict-merging step (the "Librarian") can author brand-new text that reintroduces a name.
- **Layer 3 (prompts):** the Student and router prompts explicitly tell the model: our product is Textitie, never name a competitor.
- **Layer 4 (logging):** the scrub emits a structured **warning** whenever it actually catches a name (so we can clean the source) and an **error** if a name somehow survives (the competitor list is incomplete).

If you remember one thing: **the AI is asked to behave (Layer 3), but the code guarantees it on the way to the customer (Layer 1), on the way into knowledge (Layer 2), and tells us when either catches something (Layer 4).**

---

## 3. The engine — `@workspace/brand-safety`

**Where:** `lib/brand-safety/src/index.ts` (pure, no I/O — shareable by the server and scripts). Server wrapper with logging: `artifacts/api-server/src/lib/brandSafety.ts`.

**What it exports:**

| Function | What it does |
|---|---|
| `rebrandText(input)` | Rewrites every competitor name → the brand. Returns `{ text, replacements }` (`replacements` = how many it caught; `0` = already clean). |
| `containsCompetitor(input)` | `true` if a competitor name is still present. Used for the residue check. |
| `brandName()` | The canonical brand, read live from `SAMA_BRAND_NAME` (default `Textitie`). |
| `competitorNames()` | The competitor list, read live from `SAMA_COMPETITOR_NAMES` (default `TextLine,TextLines`). |
| `rebrandAndLog(input, ctx)` | *(server wrapper)* Calls `rebrandText`, then logs a warning if it caught anything and an error if anything survived. Returns the scrubbed text. This is **Layer 4**. |

**Matching rules (important and deliberate):**
- **Case-insensitive** — one entry `TextLine` already covers `textline`, `TEXTLINE`, `TextLINE`.
- **Word-boundaried** — `\b…\b`, so it will not corrupt a larger word.
- **Possessive preserved** — `TextLine's` → `Textitie's` (only the name token is replaced).
- **Longest-first** — a more specific variant (`TextLines`) is tried before a prefix of it (`TextLine`).
- **Idempotent** — running it twice changes nothing the second time.
- **Null-safe** — `null`/`undefined`/`""` pass through untouched.
- **Two-word "Text Line" is deliberately NOT a default** — "text line" is a common English phrase and would cause false positives. Add it via config only if a specific tenant needs it.

> **⚠️ Safety:** Always use `rebrandText` / `rebrandAndLog`. Never hand-roll a `.replace()` for brand names somewhere else — it will miss the possessive, casing, or boundary rules and create an inconsistency the fortress can't see.

---

## 4. Layer 1 — Scrub every customer-facing AI reply

**Goal:** No competitor name ever reaches a customer in AI-generated text.

**Where:** `artifacts/api-server/src/lib/inboundAiPipeline.ts` (compose time) and `artifacts/api-server/src/lib/outboundReply.ts` (send time).

**What we built:**

1. **Compose-time scrub** — every place the pipeline turns an LLM result into text, it runs through `rebrandAndLog` (or `rebrandText` for internal whisper notes):
   - Auto-Pilot grounded answer
   - Co-Pilot draft reply
   - The router's polite **decline** message (out-of-scope)
   - The **flash** general-answer reply + its whisper
   - The per-tenant **fallback phrase** and Co-Pilot whisper notes
2. **Send-time guaranteed backstop** — `sendConversationReply` takes a `scrubBrand?: boolean` option. When `true`, the **final** outbound body is scrubbed again with `rebrandAndLog` immediately before it goes to the carrier. The AI auto-send path passes `scrubBrand: true`. This is the last line of defense: even if some future code path forgets to scrub at compose time, the auto-send still cannot emit a competitor name.

> **⚠️ Safety — human sends are intentionally NOT scrubbed.** `scrubBrand` defaults to `false`, so when a human agent types and sends a message it goes out **verbatim**. We never silently rewrite a person's deliberate words. Only the **autonomous** AI send path opts into the guaranteed scrub. If you add a new AI auto-send path, you **must** pass `scrubBrand: true`.

---

## 5. Layer 2 — Scrub knowledge before it can be grounded on

**Goal:** A competitor name can never enter the Classroom (the approved knowledge the AI answers from), no matter how it was sourced.

**Where:**
- `artifacts/api-server/src/lib/classroomPublish.ts` — the publish/snapshot path (the critical one).
- `artifacts/api-server/src/lib/knowledge.ts` — fact extraction (`extractFacts`).
- `artifacts/api-server/src/routes/brain.ts` — Brain-pull candidate staging.
- `artifacts/api-server/src/routes/knowledge.ts` — document-title source labels.

**What we built — the double scrub (the key insight):**
The Classroom publish scrubs facts **twice in one operation**:
1. **Before** the Librarian adjudicates — every fact's `statement` and `sourceLabel` is scrubbed, so dedup/conflict comparison happens on already-canonical text.
2. **After** adjudication — the Librarian's chosen output is scrubbed **again**, and the token count is recomputed when the text actually changed.

**Why twice?** The Librarian is itself an LLM. When it merges two conflicting facts it can author a **brand-new merged statement** that reintroduces a competitor name *after* the input-side scrub. An input-only (or output-only) scrub leaves a deterministic hole. Scrubbing both ends closes it.

Ingestion-side scrubs (extraction, Brain candidates, document titles) keep names out of the staging pool in the first place, so curators never even see them.

> **⚠️ Safety:** Any **new** write path into the knowledge tables, or any **new** LLM step that rewrites curated text, needs its own scrub. The rule of thumb: *every place curated text is created or rewritten gets a `rebrandText`.*

**Self-healing existing knowledge:** because the scrub runs on **publish**, simply **re-pushing a tenant's Classroom** cleans any already-stored facts that predate the fortress. This is the supported way to remediate production, where the agent has read-only DB access — fix it by re-publishing through the app, never by editing prod rows directly.

---

## 6. Layer 3 — Tell the LLM not to do it in the first place

**Goal:** Make the model *want* to comply, so Layers 1/2/4 rarely have to fire.

**Where:**
- `lib/ai-student/src/index.ts` — the Student **SYSTEM** prompt (the draft reply) and the **FLASH** prompt (the general in-scope answer).
- `lib/ai-router/src/index.ts` — the router's **decline** prompt (the out-of-scope message).

**What we built:** each prompt carries an explicit **BRAND SAFETY** instruction: our product is "Textitie"; never name a competing or other messaging product/brand (for example "TextLine"); if the Classroom references another product, replace it with "Textitie" or speak generically, and never tell the customer the information came from another product.

> **Note:** Layer 3 is the only layer an LLM can ignore. It reduces how often the deterministic layers fire, but it is **never** the guarantee. Do not remove Layers 1/2/4 because "the prompt covers it."

---

## 7. Layer 4 — Catch and log every leak

**Goal:** Know when the fortress actually does work, and know if it is ever incomplete.

**Where:** `rebrandAndLog` in `artifacts/api-server/src/lib/brandSafety.ts`.

**What we built:** every scrub on a customer-facing or curated path emits structured logs:
- **`warn`** when `replacements > 0` — a competitor name was caught and rewritten. This is the early-warning signal that an ingestion source is dirty or a prompt slipped; clean the source.
- **`error`** when a competitor name is **still present after** the scrub — the configured `SAMA_COMPETITOR_NAMES` list is missing a variant. This should never happen; treat it as a config bug to fix immediately.

**How to use it:** search the API server logs for the brand-safety messages. A steady stream of `warn`s points you at the dirty knowledge source to clean; any `error` means **add the missing name to `SAMA_COMPETITOR_NAMES` now**.

---

## 8. How to operate & tune it (Conductor / engineer tasks)

### 8a. Add or change a competitor name
1. Set the **`SAMA_COMPETITOR_NAMES`** secret to a comma-separated list (e.g. `TextLine,TextLines,SomeOtherApp`). Names are matched case-insensitively, so add each distinct spelling/plural, not each casing.
2. Restart the **API Server** workflow so the new value is read. (Dev reads the live env on each call, but restart to be certain.)
3. For production, update the deployment secret **and re-publish** — saving a prod secret does not restart the running deployment.
4. **Re-push affected tenants' Classrooms** so any stored facts containing the newly-added name are scrubbed on publish.

### 8b. Change the canonical brand name
1. Set **`SAMA_BRAND_NAME`** (default `Textitie`).
2. Restart the API server (and re-publish for prod). Re-push Classrooms to rewrite stored facts to the new brand.

### 8c. Clean a tenant whose knowledge predates the fortress
1. Open the tenant in the Control Plane.
2. **Re-push the Classroom** (full snapshot). The publish-time scrub rewrites every published fact.
3. Check the logs (Layer 4) — a burst of `warn`s here is expected and confirms it caught and cleaned the old names.

> **⚠️ Safety:** Production DB is **read-only** to the agent. Never try to fix stored brand leaks with raw SQL against prod — the only correct remediation is a Classroom re-push through the app.

---

## 9. How to verify it works

**Automated tests (run per-file; the api-server suite uses the real test DB):**
- `pnpm --filter @workspace/api-server exec vitest run src/lib/brandSafety.test.ts` — the engine: casing, possessive, word-boundary, idempotency, null-safety, config overrides.
- `pnpm --filter @workspace/api-server exec vitest run src/lib/classroomPublish.brand.test.ts` — the **double-scrub** regression: proves a Librarian-reintroduced competitor name is scrubbed before it is inserted into the Classroom.

**Manual smoke check:**
1. In a dev tenant, add a fact whose statement names a competitor (e.g. "We're faster than TextLine").
2. Push the Classroom. Confirm the stored/published fact reads "…faster than Textitie".
3. Send the tenant an inbound that would surface that fact in Co-Pilot/Auto-Pilot. Confirm the draft/auto-reply says "Textitie", and that a Layer-4 `warn` appears in the logs if a name was caught.

---

## 10. Hard safety rules & design decisions

- **Deterministic layers are the guarantee; the prompt is not.** Never drop Layers 1/2/4 in favor of Layer 3.
- **Human sends are verbatim.** `scrubBrand` defaults to `false`. Only autonomous AI sends pass `scrubBrand: true`. Adding a new AI auto-send path? Pass `scrubBrand: true`.
- **Scrub both ends of the Classroom publish.** The Librarian (an LLM) can author a brand-new merged statement; an input-only scrub is a hole.
- **Every new curated-text write or LLM rewrite gets a `rebrandText`.** No exceptions.
- **One spelling per casing is enough**, but add every distinct word/plural to `SAMA_COMPETITOR_NAMES`. "Text Line" (two words) is excluded by default to avoid false positives — add it only deliberately.
- **Remediate prod by re-publishing, never by raw SQL.** The scrub runs on publish, so a Classroom re-push self-heals stored facts.
- **A Layer-4 `error` is a config bug.** It means a name survived the scrub — extend `SAMA_COMPETITOR_NAMES` immediately.

---

## 11. Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| v1.0 | 2026-06-27 | Platform / LLM-stack team | Initial manual. Documents the four-layer brand-safety fortress: the `@workspace/brand-safety` engine; Layer 1 runtime reply scrub (compose-time + the `scrubBrand` send-time backstop); Layer 2 knowledge ingestion + the Classroom double-scrub (input and post-adjudication); Layer 3 Student/router prompt rules; Layer 4 `rebrandAndLog` leak logging. Includes operating/tuning tasks, verification steps, and the hard safety rules. |
