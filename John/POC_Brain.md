# POC Brain — External Knowledge Ingestion for Textitie (SAMA)

> **Status:** Spec for POC 1.0 (build now), with a 1.1 mod path called out inline.
> **Owner:** (you) · **Author:** Agent · **Last updated:** 2026-06-23
> **One-line goal:** *Get vendor-neutral, industry-true answers into a tenant's Brain faster, so the Student can answer more customer questions — without ever letting a competitor's claim become Textitie's liability, and without flooding the human reviewer.*

---

## 0. TL;DR (read this first)

- The Brain is a **separate, external process** on a cron. It crawls competitor help-docs, **re-authors them into vendor-neutral industry facts**, and **POSTs cleaned text into the existing SAMA Library** over HTTPS. That's the *entire* contact surface.
- The Brain **never** writes facts, Classroom, or "published truth." It stages raw text in the Library; your **existing Human + Professor flow promotes it** — exactly what you already do by hand with TextLine.
- **POC 1.0 uses 2 LLMs** inside the Brain (Re-Author + Verifier). Crawling/parsing is **deterministic, no LLM**. The **human is the 3rd reviewer** (not an LLM) at the Professor stage.
- **Zero changes to the SAMA codebase** are required for POC 1.0. It rides existing endpoints.
- **Blast-radius rule:** run the POC against a **dedicated demo tenant in Co-Pilot mode**, so nothing the Brain ingests can auto-send to a real customer while you tune it. (See §7 — this is important and non-obvious.)

---

## 1. WHY — purpose & the one metric that matters

**Purpose:** fill *real grounding gaps* so the Student can ground-and-answer more inbound questions (the "what is a text message" class), and stop bouncing elementary questions to a human.

**Success metric (the only one):**
> *How many real customer questions can now be grounded-and-answered that couldn't before — WITHOUT raising the human-review burden or the false-send rate.*

This is deliberately **not** "how much did we scrape." Volume is the enemy here (review fatigue). Value = coverage of questions customers actually ask.

**Non-goals:** copying competitor features/pricing/certs into Textitie's mouth; building a vector DB; touching the live SMS hot path.

**What this IS vs. is NOT (read this — it is the easy misread):** the Brain is a **vendor-neutral Library _bootstrapper_** — it uses competitor help-docs as raw *source material* to build *your own* industry-true Library faster. It is **NOT** a **competitor-intel _harvester_** — it does not store, surface, or act on "what competitor X offers." De-branding is the *feature*, not a loss: a competitor's de-identified capability statement, where your features are on par, becomes a true Textitie fact. Where they are *not* on par, that fact is a liability — see Gate 7.

---

## 2. The non-negotiable gates (the safety contract)

Everything the Brain does must respect these. They mirror invariants already enforced inside SAMA:

1. **External input is CANDIDATE-only.** Brain output lands as raw Library text → human-promoted → only then published/sendable. Never auto-published.
2. **No backdoor.** Brain uses the existing HTTP ingestion API + the existing Librarian adjudication. No direct DB writes.
3. **Provenance is mandatory.** Every ingested item carries its source URL + scrape date + a "BRAIN" tag (POC 1.0: baked into the document title; 1.1: dedicated columns).
4. **Trust tier ≠ safety category.** "Do I believe it?" (trust) is a different axis from "is it safe to auto-send?" (category). Never merge them.
5. **The radioactive rule.** A competitor's *first-person claim* ("we are HIPAA compliant", "$15/user", "native Salesforce") must **never** be re-branded as Textitie's. The Brain extracts the *vendor-neutral concept* and **discards the claim**.
6. **Litmus test for every candidate fact:** *If you delete the company name and the sentence becomes a claim about a specific company, it is NOT a Textitie fact.* It is, at most, labeled competitive intel (1.1) — never sendable.
7. **The parity rule (Brain-sourced facts only) — neutralization ≠ truth.** Stripping the brand fixes the *branding* and *legal* posture; it does **not** make the claim *true for Textitie*. A de-branded capability ("SMS platforms support scheduled campaigns") can be accurate for a competitor yet **false for Textitie** — and a grounded Student would then promise a customer something the product can't do. **Therefore every Brain-sourced candidate must be human-verified to map to a real, current Textitie capability before promotion to Classroom.** Tag Brain candidates **`needs-parity-check`** so the reviewer's job is explicitly "verify against the real product," not "rubber-stamp." Never Auto-Pilot an un-curated Brain fact.

---

## 3. WHERE — topology & hosting

```
┌─────────────────────────────────────────┐         ┌─────────────────────────────────────────┐
│  POC BRAIN  (external, isolated, cron)   │         │  SAMA / Textitie  (existing production)    │
├─────────────────────────────────────────┤         ├─────────────────────────────────────────┤
│ 1. Crawl competitor sitemaps (det.)      │         │  Express API under /api                    │
│ 2. Extract clean text (det. parser)      │         │  - Library (knowledge_documents + chunks) │
│ 3. LLM #1 Re-Author → candidate facts    │         │  - Professor (human curation)             │
│ 4. LLM #2 Verifier → approve/reject      │  HTTPS  │  - Classroom (published, versioned)       │
│ 5. POST approved text to Library  ────────┼────────▶│  - Student (reads published Classroom)    │
│    (Conductor Basic auth)                │  (only  │                                           │
│                                          │  link)  │  Postgres FTS (tsvector+GIN). NO vectors. │
└─────────────────────────────────────────┘         └─────────────────────────────────────────┘
```

- **Hosting decision (LOCKED): the Brain is its OWN Replit Repl with a `scheduled` (cron) deployment**, separate from the SAMA repl. It is *not* part of the SAMA monorepo and shares no database with it.
  - **Why a separate repl:** a repl has exactly **one** `deploymentTarget`. The SAMA repl is already `autoscale` — a *single* deployment that path-routes `/` (user-app, static) + `/admin/` (Control Plane, static) + `/api` (the one Node server) on one domain. You **cannot** run a second, `scheduled` deployment from that same repl; the targets conflict. A dedicated Brain repl gives it its own deploy, schedule, secrets, and failure domain.
  - **Why `scheduled`, not autoscale:** the Brain serves no public traffic and needs no URL — it's a cron job that calls SAMA's API. `scheduled` runs on the configured cadence (§8) and nothing more.
  - **Why this de-risks go-live:** the core SMS product launches on the SAMA `autoscale` deployment. A separate Brain deployment means a Brain build error or crash can **never** take down `/`, `/admin`, or `/api`. The two launches succeed or fail independently.
- **Only link to SAMA = HTTPS calls to `/api/...`.** If the Brain dies, SAMA is unaffected. If SAMA is down, the Brain retries next tick.
- **Retrieval substrate in SAMA is Postgres full-text search (tsvector + GIN), not vectors.** Do not stand up a vector store. The Brain pushes plain text; SAMA's existing FTS indexes it on ingest.

---

## 4. HOW — the seam contract (the make-or-break)

This is the exact, verified integration. The Brain authenticates as the **Conductor** (HTTP Basic; the `CONDUCTOR_PASSWORD` secret) and calls these real endpoints. All are mounted under `/api`.

### 4.1 Push cleaned text into the Library  ← **the Brain's primary call**

```
POST /api/tenants/:tenantId/library/text
Auth: HTTP Basic (Conductor)
Body (JSON):
  {
    "title": "[BRAIN][industry][<category>] <short topic> #<src-hash> 2026-06-23",
    "text":  "<re-authored, vendor-neutral fact text>"
    // DO NOT send sessionId. The field is an OPTIONAL number — sending null 400s. Omit it entirely.
  }
Effect: creates a knowledge_documents row (source_type="paste", status="ready"),
        auto-chunked + FTS-indexed. This is a RAW SOURCE, not a published fact.
```

- **Use `/library/text`, NOT `/library/url`.** `/library/url` makes the *server* re-fetch the raw competitor page (bypassing the Brain's re-authoring) → raw competitor claims would enter the Library. The Brain has already fetched + cleaned + re-authored, so it pushes the *finished text* via `/library/text`.
- **`title` is capped at 300 chars** — do NOT paste full source URLs into it. Put short tags + a `#<src-hash>` (first 8 chars of the source-URL hash) + date in the title, and keep the **full source URL in the Brain's own state DB** (§4.3). 1.1 adds first-class `source_url` / `trust_tier` fields to the ingest body + `knowledge_documents` so provenance lives in real columns.
- **`sessionId`: omit it.** It is an optional *number* (not nullable); passing `null` returns 400. The POC Brain never uses it.

### 4.2 The human promotion path (already exists — the Brain does NOT call these)

Your existing Professor UI / endpoints do the promotion. Listed so engineers see the full chain:

| Step | Endpoint | Who |
|---|---|---|
| Open/curate session | `POST /api/tenants/:tenantId/professor/sessions` (+ `/messages`, `/stream`) | Human |
| Absorb an answer into facts | `POST /api/tenants/:tenantId/professor/sessions/:sessionId/messages/:messageId/absorb` | Human |
| List candidate facts | `GET /api/tenants/:tenantId/professor/sessions/:sessionId/absorbed` | Human |
| Accept / reject a fact (`draft`→`published`/`rejected`) | `POST /api/tenants/:tenantId/professor/absorbed/:factId/status` | Human |
| Set fact category | `POST /api/tenants/:tenantId/professor/absorbed/:factId/category` | Human |
| Publish to Classroom (runs Librarian dedup/conflict via `adjudicateForPush`) | `POST /api/tenants/:tenantId/classroom/push` | Human |

- `absorbed_facts.status` flows `draft → published` (or `rejected`); the **Librarian** marks `conflict` at push time when a new fact contradicts an existing one (with a `conflict_reason`), and the human resolves it. **This conflict adjudication is reused for free.**
- Fact `category` (`pricing | compliance | features | technical_setup | general`) is what drives the live auto-send gate downstream — see §6.

### 4.3 What the Brain must store on its own side (its tiny state DB)
For idempotency/trickle (so cron re-runs don't duplicate): `(source_url, content_hash, last_seen_at, last_pushed_at, status)`. Re-scrape with an **unchanged hash = no-op**. Changed hash = re-process (the Librarian will catch the resulting conflict on the human's next push).

### 4.4 How knowledge enters SAMA + the 6 safeguards (verified against `knowledge.ts` — give this to the engineer)

**Ingress (one call):** the Brain's *only* write into SAMA is `POST /api/tenants/:tenantId/library/text` (Conductor Basic auth). It creates a raw `knowledge_documents` row (`source_type="paste"`, auto-chunked + FTS-indexed) — **raw candidate text, never a published fact.** The Brain never writes the DB, facts, or the Classroom directly. That containment is the foundation; the worst a buggy/compromised Brain can do is drop raw text into one tenant's Library.

The contamination guards, defense-in-depth (**★ = enforced in SAMA code, not just convention**):

1. **Candidate-only ingress.** Brain text is raw Library *source*, not truth — not a fact, not in the Classroom. Nothing the Student treats as authoritative changes when the Brain pushes.
2. **★ Mandatory human accept.** `/classroom/push` publishes *only* facts a human set to `status="published"`; `draft` and `rejected` are never pushed. Brain content cannot become Classroom truth without a human clicking accept.
3. **★ Librarian conflict adjudication.** On push, `adjudicateForPush` collapses near-duplicates and **flags contradictions against existing knowledge** as `conflict` (excluded from the published snapshot, held for human resolution). If everything conflicts, nothing publishes. A Brain fact can't silently overwrite your KB.
4. **★ Category auto-send gate.** Even once published, only `general`/`features` facts can auto-send; `pricing`/`compliance`/`technical_setup` always route to a human.
5. **Provenance tag.** Every Brain item carries `[BRAIN]` + source-hash + date (1.1: dedicated columns) → always distinguishable, auditable, reversible.
6. **Parity check (Gate 7).** A human confirms the de-branded fact is true *for Textitie* before promotion (`needs-parity-check`). Neutralization ≠ truth.

**The one caveat (see §7):** the Library is not fully inert — the Professor *escalation* loop reads **raw** Library text before promotion and can auto-send in Auto-Pilot via the fail-closed escalation gate. So while tuning, point the Brain at a **demo tenant in Co-Pilot/Manual** (blast radius = 0 real customers). 1.1 adds a "holding/unverified" flag that excludes un-promoted Brain rows from escalation retrieval.

---

## 5. HOW MANY LLMs — roster & roles

**POC 1.0 = 2 LLMs in the Brain + 1 human reviewer. Crawling is deterministic (0 LLMs).**

| # | Role | Model (POC 1.0) | Input → Output | Why it exists |
|---|---|---|---|---|
| — | **Crawler / Parser** | *No LLM* — use a readability/boilerplate extractor (e.g. `trafilatura` / Mozilla Readability) | sitemap.xml + HTML → clean article text | Deterministic, cheap, fast. An LLM here only adds nondeterminism. |
| 1 | **Re-Author / Extractor** (reasoning) | Grok-4-class reasoning (reuse `GROK_KEYS`; provider-agnostic since Brain is external) | clean text → JSON array of candidates: `{ statement (vendor-neutral), category, kind: "industry"\|"vendor_claim", sourceUrl }` | Strips identity, classifies industry-knowledge vs vendor-claim, assigns category, rewrites into standalone vendor-neutral statements. |
| 2 | **Verifier** (fail-closed gate) | Fast Grok-4-class (or same model, separate strict prompt) | each candidate → `{ approved: bool, reason }` | The safety boundary. **Rejects** anything that names/implies a specific company, asserts a Textitie capability/cert/price/SLA, or reads as a *commitment* rather than *education*. Only `approved && kind=="industry"` gets pushed. |
| 3 | **Human reviewer** (NOT an LLM) | — | Library text → published Classroom fact (via §4.2) | Final promotion gate + trust grading. Already in your workflow. |

**Prompts (skeleton):**
- *Re-Author:* "You are extracting **industry-general** SMS/messaging knowledge. For each idea, output a standalone sentence true for ANY vendor. If a sentence asserts something specific to a company (their cert, price, integration, SLA), set `kind:"vendor_claim"`. Assign category ∈ {pricing, compliance, features, technical_setup, general}. Never write the words 'Textitie' or any competitor name into `statement`."
- *Verifier:* "Reject if the statement (a) implies a specific company, (b) claims a Textitie capability/cert/price/SLA, or (c) is a promise/commitment rather than an explanation. Otherwise approve. Output JSON only."

**1.1 upgrade path:** split #1 into **Pro (argue include)** + **Con (argue exclude)** with #2 promoted to **Judge** → the Pro/Con/Verifier panel, run **offline only**. Add a small "competitive-intel" store for `kind:"vendor_claim"` items (labeled, never sendable).

---

## 6. Categorization is the bridge to the live safety gate

The live system only auto-sends answers grounded in **`general`** or **`features`** facts. **`pricing` / `compliance` / `technical_setup`** always route to a human, even in Auto-Pilot. So:

- The Brain's **best, safest yield is `general`/`features` industry education** — and that is *exactly* the class that embarrassed Auto-Pilot ("what is a text message"). Fill it well and elementary questions start flowing safely.
- Anything the Re-Author tags `pricing`/`compliance`/`technical_setup` will (correctly) be human-gated forever. Don't fight that; it's the guardrail.
- **Caution on eloquence:** wording like "secure/encryption" auto-classifies as `compliance`. Keep re-authored *general* facts plain so they don't accidentally self-tag into a gated category.

---

## 7. Blast-radius isolation (important, non-obvious)

The Library is not a fully inert staging area: **the Professor *escalation* loop retrieves Library context to answer ungrounded questions, and in Auto-Pilot can auto-send a gated escalation answer.** That means Brain-ingested Library text *can* reach a customer via escalation **before** a human promotes it — subject to the fail-closed escalation gate (safe categories, high confidence, non-risky intent, compliance OK).

For a vendor-neutral `general` fact that's fine. But while you're *tuning* the Brain, do not take the risk:

> **POC 1.0 rule: point the Brain at a dedicated DEMO tenant whose engagement mode is Co-Pilot (or Manual).** In Co-Pilot nothing auto-sends — the human sees every draft. This caps the blast radius to zero real customers with **no code change**.

**1.1 hardening:** add an "unverified/holding" flag on Brain-ingested Library rows that the escalation retrieval **excludes** until human-promoted; then you can safely run a real tenant in Auto-Pilot.

---

## 8. Trickle, not dumps (your call — endorsed)

- Cron cadence: small, scheduled batches (e.g. N URLs/run). No mass imports → no review fatigue.
- **Demand-driven targeting (highest-leverage add):** aim the trickle at your **ungrounded-query / escalation log** — scrape topics customers actually asked and the Brain missed first. Same cadence, far higher value-per-fact. (POC 1.0 can start supply-driven on `/faqs//help/`; wire demand-driven in 1.1.)

---

## 9. Scope split

### POC 1.0 — build now (hours)
- [ ] External Brain process + cron skeleton.
- [ ] Deterministic crawler/parser (sitemap → clean text).
- [ ] LLM #1 Re-Author (clean text → candidate JSON).
- [ ] LLM #2 Verifier (fail-closed approve/reject).
- [ ] Idempotency store (`source_url + content_hash`).
- [ ] `POST /api/tenants/:DEMO/library/text` with provenance in the title.
- [ ] Human promotes via existing Professor UI → Classroom.
- [ ] Demo tenant set to **Co-Pilot**.

### 1.1 — after first run
- [ ] Pro/Con/Judge panel (offline).
- [ ] First-class `source_url` + `trust_tier` (A/B/C) columns on ingest + `knowledge_documents`/`absorbed_facts`.
- [ ] Competitive-intel store for `vendor_claim` items (labeled, never sendable).
- [ ] Demand-driven targeting from the escalation log.
- [ ] "Holding/unverified" Library flag so escalation can't read un-promoted Brain content → safe Auto-Pilot.

---

## 10. Engineer hand-off checklist

**Hosting (LOCKED — see §3):**
- Create a **NEW, separate Replit Repl** for the Brain. Do NOT add it to the SAMA monorepo.
- Set that repl's deployment to **`scheduled`** (`deploymentTarget = "scheduled"`) and configure the cron cadence (§8).
- Leave the **SAMA repl unchanged** (`autoscale`). One repl = one deployment target — that is *why* the Brain needs its own repl.
- The Brain reaches SAMA only over HTTPS at `$SAMA_BASE_URL/api/...`; no shared DB, no shared deployment, independent failure domains.

**Secrets the Brain needs (in the Brain's OWN env, not SAMA's):**
- `SAMA_BASE_URL` — e.g. `https://<your-textitie-domain>`
- `SAMA_CONDUCTOR_USER` / `SAMA_CONDUCTOR_PASSWORD` — Conductor Basic creds
- `BRAIN_LLM_KEY` — Grok (or chosen provider) key
- `SAMA_DEMO_TENANT_ID` — the isolated POC tenant

**Definition of done for POC 1.0:**
1. One cron run ingests ≤N competitor URLs into the demo tenant's Library as `[BRAIN]`-tagged documents.
2. No `vendor_claim` text ever reaches the Library (verify by inspecting pushed titles/text).
3. Human can absorb → accept → push to Classroom unchanged.
4. A previously-ungrounded test question now grounds against a Brain-sourced `general` fact in the demo tenant.
5. Re-running the cron with unchanged sources creates **zero** duplicate Library rows.

**Smoke test (manual):**
```
curl -u "$SAMA_CONDUCTOR_USER:$SAMA_CONDUCTOR_PASSWORD" \
  -H 'Content-Type: application/json' \
  -X POST "$SAMA_BASE_URL/api/tenants/$SAMA_DEMO_TENANT_ID/library/text" \
  -d '{"title":"[BRAIN][industry][compliance] SMS opt-in basics (src: example, 2026-06-23)","text":"Recipients must give prior express consent before a business sends marketing text messages."}'
```

---

## 11. Open decisions for the human (please answer before/while building)

1. **Tenant scope:** one demo tenant for the POC? (Recommended.) There is no global "Master Library" — SAMA's Library is **per-tenant**. A shared industry layer for all tenants is a real 1.1 design task, not a freebie.
2. **A/B/C trust scale:** define one monotonic meaning (recommend **Tier 1 = verified/authoritative, Tier 2 = corroborated, Tier 3 = unverified/scraped**, with scraped defaulting to Tier 3 + human-promotion-required). POC 1.0 treats *all* Brain content as Tier 3; 1.1 makes it explicit.
3. **Competitors + URL filters** for the first crawl (e.g. Textline/Salesmsg/Podium `/help/`, `/faqs/`).
4. **Cadence + batch size** for the trickle.

---

## 12. Revision history
| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-23 | Initial spec: external Brain, Library-only seam, 2-LLM roster, demo-tenant blast-radius rule, 1.1 backlog. |
| 1.0.1 | 2026-06-24 | Locked hosting: Brain = its own Repl + `scheduled` (cron) deployment; added one-deployment-target-per-repl rationale and go-live de-risking (§3, §10). |
| 1.0.2 | 2026-06-24 | Stated intent explicitly (vendor-neutral Library **bootstrapper**, NOT competitor-intel **harvester**) in §1; added Gate 7 parity rule + `needs-parity-check` tag in §2. |
| 1.0.3 | 2026-06-24 | Added §4.4 — "How knowledge enters SAMA + the 6 safeguards" (verified against `knowledge.ts`), incl. the escalation-loop caveat. |
