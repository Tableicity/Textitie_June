# LLM Training Manual — Textitie (SAMA)

**Audience:** Textitie staff — platform operators (Conductors) and tenant-facing agents.
**Scope:** The complete LLM stack: the Professor, the Student, customer (SMS) interactions, the knowledge pipeline, the engagement modes, and every safety gate.
**How to read this:** Sections 1–4 are the mental model (read once). Sections 5–9 are the day-to-day mechanics. Sections 10–13 are reference tables and playbooks you will come back to.

> This is a living operational document. When the LLM behavior changes, update this file. The deep architecture-of-record lives in `README.md` and `replit.md`; this manual is the human-readable training layer on top of it.

---

## 1. The one-paragraph mental model

Every tenant (business) gets two AI workers. The **Student** is fast and cheap; it answers everyday customer texts using only the knowledge the business has already approved. The **Professor** is slow, smart, and expensive, and it has exactly **one** job: it helps the business *curate* knowledge offline, with a human (Professor sessions and Library conflict adjudication). It is **not** on any live customer-reply path — its old real-time "rescue" of the Student was **removed 2026-06-27**. **No conversation learns at runtime**; knowledge enters the Student's Classroom only when a human approves it. A human can take over **any** conversation at **any** time. **Auto-Pilot is fail-open** — it always answers or politely acknowledges every text — with a **circuit breaker** that steps a conversation down to a human (Blue) if it keeps coming up empty; the only hard send-time guard is compliance/opt-out.

---

## 2. Glossary (learn these words first)

| Term | Plain meaning |
|---|---|
| **Tenant** | A business/customer of Textitie. Everything is scoped per-tenant; no tenant ever sees another's data or knowledge. |
| **Conductor** | The platform operator (you, internal staff) using the SAMA Control Plane / admin app. |
| **Agent** | A tenant's own staff member working their SMS inbox. |
| **Customer / Contact** | The end consumer texting the tenant's number. |
| **Professor** | The heavy reasoning model (OpenRouter/Qwen, `qwen/qwen3-max`). A **creation-only** curator (Professor sessions + Library conflict adjudication). **Not on any live customer-reply path** (removed 2026-06-27). |
| **Student** | The fast model (`grok-4.20-0309-non-reasoning`). Drafts everyday replies from approved knowledge. |
| **Knowledge Base** | Raw uploaded material (PDFs, text, URLs). The intake bin. |
| **Library** | The Knowledge Base after it's been extracted and chunked for search. The Professor's reference shelf. |
| **Classroom** | The *published, approved* facts the Student is allowed to use. Versioned. |
| **Fact** | One atomic, categorized statement of truth (e.g., "The Pro plan is $50/month"). |
| **Grounded** | An answer is "grounded" when it is backed by a real Classroom fact, not a guess. |
| **Engagement mode** | How autonomous the AI is for a conversation: Manual / Co-Pilot / Auto-Pilot. |
| **Handback (Blue)** | The AI declines to send and hands the message to a human, with a one-line reason. |
| **Gate** | The decision around auto-send. Compliance/opt-out are **hard** gates re-checked at send time. Auto-Pilot's response gate is **fail-OPEN** (it always answers or acknowledges) with a circuit breaker. |
| **Brand Scope** | A short Conductor-set blurb describing what a business is and what it answers. Powers the Co-Pilot triage Router. |
| **Triage Router** | A cheap, pre-retrieval classifier (Co-Pilot only) that sorts an inbound into out-of-scope / general-in-scope / tenant-specific *before* any knowledge lookup. |
| **Fallback (holding) phrase** | A Conductor-set canned reply the Co-Pilot drafts *verbatim* when a tenant-specific question can't be grounded — a polite stall instead of a guess. |
| **Brain (Beast)** | An external knowledge source a Conductor can harvest from on demand — a second curation avenue alongside Professor sessions ("Brain + Human" mirrors "Human + Professor"). |

---

## 3. The cast: Professor vs. Student

The two roles run on **different providers** (both speak the OpenAI-compatible chat API). The **Student** runs on **Grok (xAI)** (`baseURL https://api.x.ai/v1`, key in the `GROK_KEYS` secret). The **Professor** runs on **OpenRouter (Qwen)** through the **Replit AI Integrations proxy** — no key of ours, billed to Replit credits.

| | **Student** | **Professor** |
|---|---|---|
| Model | Grok `grok-4.20-0309-non-reasoning` (override: `SAMA_STUDENT_MODEL`) | OpenRouter/Qwen `qwen/qwen3-max` (override: `SAMA_PROFESSOR_MODEL`) |
| Personality | Fast, cheap, literal | Slow, reasoning-heavy, expensive |
| Job 1 | Draft replies to inbound customer texts | Curate knowledge with a human (Professor sessions) |
| Job 2 | — | Adjudicate Library/Classroom conflicts during curation |
| Knowledge it can use | **Only the published Classroom** (+ legacy blob fallback) | The whole **Library** + its own general expertise |
| Can it "learn"? | No — never persists facts | No runtime learning — facts enter only via **human-approved curation** (Professor sessions or Brain pull) |

> **Stub / offline behavior:** Each role degrades to a harmless stub when **its own provider** is unconfigured — the **Student** when `GROK_KEYS` is unset, the **Professor** when the **OpenRouter integration** isn't connected. Inbound SMS keeps working and messages still record regardless. This is intentional — **a missing provider must never break message delivery.** Note the split: the **Student** powers *all* live customer replies (drafts and Auto-Pilot answers), so an unset `GROK_KEYS` means the Student stubs out — Co-Pilot can't draft a grounded reply and in Auto-Pilot the conversation **fails open** to a fallback acknowledgement (there is **no** "offline" chip). The **Professor's** OpenRouter integration only powers **Conductor curation** (Professor sessions and Brain adjudication) — a Professor outage never affects live replies.

> **A third, lightweight role — the Router.** In **Co-Pilot only**, a cheap pre-retrieval **triage Router** (same Grok provider/model as the Student; override `SAMA_ROUTER_MODEL`) classifies each inbound against the tenant's **Brand Scope** *before* any knowledge lookup. It never sends and never learns — it only decides which drafting path Co-Pilot takes (Section 7). Like the Student it stubs out when `GROK_KEYS` is unset, and it **fails open** to the normal grounded pipeline on any miss.

---

## 4. The 5-stage knowledge pipeline (big picture)

```
  (1) KNOWLEDGE BASE  →  (2) LIBRARY  →  (3) PROFESSOR  →  (4) CLASSROOM  →  (5) STUDENT
      raw uploads         searchable      human + AI         approved          answers live
      (PDF/text/URL)      chunks          curation           versioned facts   customer texts
```

- **Stages 1–4 are curation** (offline, human-in-the-loop, no customer is waiting).
- **Stage 5 is production** (a real customer is texting right now).
- **Stage 5 never writes back to stage 4.** **No engagement mode learns at runtime** — knowledge enters the Classroom only through human-approved curation (stages 3–4: a Professor session or a Brain pull). See Section 9.

Each stage is detailed below.

---

## 5. Stage-by-stage: how knowledge is built

### Stage 1 — Knowledge Base (intake)
The raw bin. A tenant (or Conductor on their behalf) uploads source material:
- **Formats:** PDF, TXT, MD, CSV, pasted text, and URLs.
- **PDF text** is extracted with `pdfjs-dist`.
- **URLs** are fetched with strict SSRF protection (a public-URL allow-check + a hardened DNS lookup) and converted from HTML to plain text. *Staff note: internal/private URLs are deliberately blocked — this is a security feature, not a bug.*

Nothing here is usable by the Student yet. It's just raw material.

### Stage 2 — Library (searchable reference shelf)
Extracted text becomes **documents**, which are split into **chunks** (~1,800 characters, on paragraph boundaries). Chunks are indexed with **Postgres full-text search** (`tsvector` + a `GIN` index). There are **no vector embeddings** — retrieval is keyword/full-text only.

The Library is what the **Professor reads** during curation (Professor sessions and Brain-pull adjudication). It is *not* what the Student reads — the Student only reads the Classroom.

### Stage 3 — Professor sessions (human-in-the-loop curation)
In the admin **Professor** page, a Conductor opens a **Memory Session** (max **5 active per tenant**) and chats with the Professor. The Professor answers using the Library + its own expertise. When an answer is good, the operator asks the Professor to **absorb** it — the Professor extracts **atomic facts** from its own answer. Each fact is:
- assigned a **category** (see below), and
- left in **`draft`** status for a human to **accept (✓)** or **reject (✕)**.

This is the quality gate where a human decides what becomes truth.

#### Stage 3, alternative avenue — Brain knowledge pull ("Brain + Human" mirrors "Human + Professor")
Besides Professor sessions, a Conductor can **harvest knowledge from an external Brain/Beast service** straight into the *same* candidate-fact pool. The Conductor triggers a pull, reviews the harvested candidates (exact/normalized duplicates are deduped on pull; contradictions arrive **flagged with a reason** and rendered unchecked), fixes categories, approves, and pushes — and from there the facts ride the **exact same Librarian adjudication and Classroom snapshot** as Professor facts (where deeper semantic dedup/conflict adjudication happens). There is no separate Brain pipeline or Brain table: approved Brain facts become Student-groundable for free, and a Classroom snapshot is always the full union of *every* published fact (Professor **and** Brain), so one source can never wipe the other. The feature is **Conductor-only** and stays safely dormant (the page reports the service is unavailable) until the Brain service is configured. Click-path is in the How-To guide.

### Stage 4 — Classroom (the approved, versioned truth)
Accepted facts are **pushed to the Classroom**, which creates a new **Classroom version**. Only the **current published version** is visible to the Student. Old versions become `superseded` (kept for history, never read live).

Pushing isn't a blind copy — the **Librarian** adjudicates it first (Section 8).

#### Fact categories (these tag each fact for retrieval & curation)
| Category | Examples | Notes |
|---|---|---|
| `general` | Hours, location, general info | Everyday |
| `features` | What the product does | Everyday |
| `pricing` | Prices, discounts, billing | High-stakes — verify before publishing |
| `compliance` | Legal, TCPA, consent, refunds | High-stakes — verify before publishing |
| `technical_setup` | Install/config steps that can break things | High-stakes — verify before publishing |

> **Why these categories matter:** money, law, and breakage. Give `pricing` / `compliance` / `technical_setup` facts extra scrutiny **before you publish** them — once a fact is published, Auto-Pilot may quote it verbatim (Auto-Pilot is *closed-book*: it only ever sends what a human approved). Categories also make the Librarian dedup these topics more tightly. **Note (changed 2026-06-27):** category no longer *blocks* auto-send — the legacy "never auto-send risky categories" gate was retired. The only hard runtime guard is **compliance/opt-out** (Section 10). If a topic must always be human-reviewed, keep that conversation in **Co-Pilot**.

#### Fact statuses
`draft` (new, awaiting human) → `published` (live in a Classroom version) → `conflict` (flagged as contradictory) ; plus `rejected` (a human said no).

### Stage 5 — Student (production)
When a real customer texts in, the Student reads the **current Classroom**, drafts a reply, and the engagement mode + gates decide what happens next. This is the whole of Section 6.

---

## 6. Customer interaction: the inbound SMS pipeline, step by step

This is the most important section for agents. When a customer text hits the tenant's number, here is the exact order of operations. The inbound is captured and **acknowledged to Twilio right away**; the AI's slower work (the Router and drafting below) runs **in the background, off the response path** — so the AI's thinking never delays message receipt.

**Step 1 — Authenticate & route the message.**
- The Twilio signature is verified (rejects spoofed webhooks).
- The destination number resolves to exactly one tenant (canonical phone-number routing).
- Blocked contacts are dropped (audit-logged, not processed).

**Step 2 — Record durably.**
- The contact is upserted (new vs. returning is detected).
- The conversation is found or opened.
- The inbound message is written and the inbox UI is notified in real time (`message:new`). **The customer's text is now safely stored regardless of what the AI does next.**

**Step 3 — Mirror to CRM (if configured).** Inbound text is forwarded to Chatwoot.

**Step 4 — Automation engine (deterministic, runs before AI).**
- **Opt-out keywords** (`STOP`, `QUIT`, etc.): recorded in the opt-out list, a TCPA confirmation is sent, the conversation is closed. *(Already opted-out senders are ignored.)*
- **Resubscribe** (`START`): deletes the opt-out.
- **Welcome / keyword auto-replies:** matched against the tenant's automation rules by priority.
- **Campaign attribution:** if nothing handled the message, it's attributed to any active campaign.
- If automation handled the message, **the AI does not run.**

**Step 5 — Co-Pilot triage Router (Co-Pilot only, BEFORE any retrieval).**
- Runs **only in Co-Pilot**, and **only** when the tenant has a **Brand Scope** set and `GROK_KEYS` is configured. It classifies the inbound against the Brand Scope into one of three intents (Section 7):
  - **out_of_scope** → drafts a short, polite **decline** into the composer and stops.
  - **general_in_scope** → drafts a quick **"flash"** answer from the model's general knowledge (no Classroom lookup, no Professor) and stops.
  - **tenant_specific** (or *any* uncertainty/failure) → falls through to Step 6, the normal grounded pipeline.
- **Fail-open:** no Brand Scope, no key, **anything below high confidence**, a missing decline message, or any error all fall through to Step 6. (Only a *high-confidence* off-scope or general classification ever leaves the grounded path.) **Auto-Pilot and Manual skip this entirely.** Nothing here is sent or learned — the customer text stays query-only.

**Step 6 — Student drafts (if mode ≠ Manual and automation/Router didn't already resolve it).**
- `retrieveClassroomFacts` pulls grounded facts from the current Classroom (full-text search, category-boosted — see Section 7).
- The Student is prompted to produce **four labeled sections**:
  1. **SUMMARY** — what the customer is asking.
  2. **DRAFT REPLY** — the proposed SMS.
  3. **KB MATCH** — which knowledge it used (or `none`).
  4. **CONFIDENCE** — `high` / `medium` / `low`.
- The reply's **`kbMatched`** flag is true only when KB MATCH is **not** `none`. Combined with a real Classroom search hit, this is what decides whether the answer is "grounded."

**Step 7 — Co-Pilot fallback holding phrase (Co-Pilot only, when ungrounded).**
- Runs **only in Co-Pilot**, and **only** when the tenant has a **Fallback Phrase** set and this inbound is **ungrounded** (no Classroom hit *and* the Student found no KB answer).
- It drafts the human-written holding phrase **verbatim** into the composer and **stops.** The point is "don't guess on a tenant-specific question; stall politely, then a human runs the offline Professor + Human loop for the real answer."
- **Fail-open:** with no phrase set, Co-Pilot simply keeps the **Student's own best draft** (Step 6) for the agent to review. **Auto-Pilot and Manual skip this step entirely.**

**Step 8 — Engagement mode decides the outcome** (full detail in Section 7).
- **Manual:** stop. No draft surfaced, no send, no learning.
- **Co-Pilot:** save the draft, pre-fill the agent's composer, wait for a human to edit & send. (Never learns.)
- **Auto-Pilot:** run the **fail-OPEN** turn gate (Section 7 / Section 10): a Classroom match → grounded auto-send (stays green); no match → graceful out-of-scope ack (stays green); responder error → graceful fallback ack. A run of fallbacks trips a **circuit breaker** → final ack + step down to Blue. (Never learns.)

**That's the whole inbound path — there is no Step 9.** The old live Professor-escalation / self-learning step that used to sit here was **removed 2026-06-27** (Section 9). Nothing on the inbound path ever calls the Professor or persists a fact: an ungrounded Co-Pilot turn keeps the Student's own draft (or the fallback phrase); an ungrounded Auto-Pilot turn sends a graceful ack. Knowledge enters the Classroom only through human-approved curation.

---

## 7. Engagement modes (the agent's primary control)

Every conversation runs in one of **three** modes. The effective mode = the per-conversation override if set, otherwise the tenant default. (`resolveEffectiveEngagementMode`.) The DB default is **Co-Pilot**. Legacy names are auto-translated on save (`assisted`→Co-Pilot, `gated_auto`→Auto-Pilot); anything unrecognized falls back to Co-Pilot (the safe choice).

| Mode | Inbox color | AI drafts? | AI sends by itself? | AI learns? |
|---|---|---|---|---|
| **Manual** | 🔵 Blue | No | No | No |
| **Co-Pilot** | 🟡 Yellow | Yes | No (human sends) | No |
| **Auto-Pilot** | 🟢 Green | Yes | **Yes — answers or acks every turn** (fail-open + circuit breaker) | **No — never learns** |

### Manual (🔵)
AI is fully off for this conversation. No Student draft, no auto-send, no learning. A new inbound clears any pending AI state. Use this for sensitive or VIP conversations where you want zero AI involvement.

### Co-Pilot (🟡)
The Student (Grok) drafts — grounded in the approved Classroom when it matches, otherwise its own best draft (or the tenant's Fallback Phrase, below). **The Professor is not consulted at runtime** (its live escalation was removed 2026-06-27). The draft is saved and **pre-filled into the composer**; a human edits and sends. **Co-Pilot never learns** — nothing a human touches is persisted as truth. This is the default and the safest "AI helps but doesn't act" setting.

> **Co-Pilot's two extra layers (Brand Scope & Fallback).** Co-Pilot can short-circuit *before* or *after* drafting — both are **Co-Pilot-only** and both **fail open** (any miss falls through to the normal grounded draft):
> - **Brand-Scope triage Router (before retrieval).** When the Conductor has set a **Brand Scope** for the tenant, every Co-Pilot inbound is first sorted into *out-of-scope* (drafts a polite decline), *general-in-scope* (drafts a quick general-knowledge "flash" answer — no Classroom/Professor), or *tenant-specific* (the normal grounded path). When in doubt it **always** picks tenant-specific, so it can only ever *save time*, never hide a real answer.
> - **Fallback holding phrase (after drafting, when ungrounded).** When the Conductor has set a **Fallback Phrase** and an inbound reaches the grounded pipeline but the Student still can't ground it (no Classroom/KB match — typically a question that needs this business's specific facts), Co-Pilot drafts that phrase **verbatim** as a holding reply — a deliberate, on-brand *stall* instead of a guess. **With no phrase set, Co-Pilot keeps the Student's own best draft** for the agent. A human edits/sends it and can then run the offline Professor + Human loop for the real answer.
>
> Both are configured by the Conductor on the tenant's detail page; neither ever auto-sends or learns.

### Auto-Pilot (🟢)
Auto-Pilot is **closed-book and fail-OPEN**: every inbound gets a turn and the conversation never silently stalls. The Student answers **only** from the approved Classroom (no Professor, no learning). Per inbound the turn gate runs top-down, first match wins (`evaluateAutoPilotTurn`, Section 10):
- **Compliance/opt-out fails** → suppress the AI (hard guard, re-checked at send).
- **A human already took this turn** → defer (no AI send).
- **Classroom match** → stitch a **grounded** Student answer and **auto-send verbatim**; stays green (resets the consecutive-fallback run).
- **No match** → send a graceful **out-of-scope acknowledgement**; the conversation **continues green**.
- **Responder/LLM error** → send a graceful **fallback acknowledgement** (never silent).
- **Circuit breaker** → on the **3rd consecutive** fallback **OR more than 3** fallbacks in a rolling **2-minute** window, send a **final acknowledgement** and **step the conversation down to Blue** (`engagementModeOverride = manual`). This is **not** auto-cleared — a human re-enables Auto-Pilot once they've trained it.

The acknowledgements use the tenant's `autopilotHoldingPhrase` if set, otherwise a built-in default (**never blank**). **Auto-Pilot never learns.** A human can step into any Auto-Pilot conversation at any time; the moment a human sends, that pending turn is marked `human_handled` and the conversation returns to green for the next turn.

#### Retrieval detail staff sometimes ask about
- The query's category (pricing/features/etc.) is used to **boost** ranking, **not to filter** — so a misclassified question can never hide a relevant fact.
- Full-text search first tries strict **AND** semantics (all words must match); if that returns nothing, it falls back to **OR** semantics so conversational, wordy questions still find facts.

---

## 8. The Librarian: keeping the Classroom clean

When facts are pushed to the Classroom — by a human, via a **Professor session** or a **Brain pull** — the **Librarian** runs first so the Classroom never fills with duplicates or silent contradictions.

- **De-duplication:** near-identical facts are clustered by **trigram (3-character) similarity** (threshold ~0.30, tightened to ~0.18 for sensitive categories) and collapsed.
- **High-stakes contradiction catch:** if two facts mention the **same subject** (e.g., "Pro Plan") but **different numbers** (e.g., "$50" vs "$60"), they're forced into review even if the wording differs.
- **The model adjudicates each cluster:**
  - **merge** — combine into one clean statement,
  - **conflict** — flag both as `conflict` for a human to resolve in the Professor/Classroom UI,
  - **distinct** — keep them separate.
- **Concurrency safety:** every Classroom write (a human Professor or Brain push) takes the same `CLASSROOM_PUSH_LOCK` advisory lock, so versions are written one at a time and never corrupt each other.

> **Conflicts (a curation-quality concern):** when two published facts contradict, the Librarian flags both `conflict` so a human resolves them in the Professor/Classroom UI. Keep the Classroom contradiction-free so the Student never grounds an answer on conflicting data. (The hard *runtime* guard on auto-send is compliance/opt-out, re-checked at send — Section 10.)

---

## 9. Why no conversation learns at runtime (the removed self-learning loop)

**The headline:** **no engagement mode learns from a live conversation.** There is no Student→Professor escalation on the inbound path, and the inbound path never persists a fact. Knowledge enters the Classroom **only** through human-approved curation: a **Professor session** (Section 5, Stage 3) or a **Brain pull** (Section 5a / the How-To). This changed **2026-06-27**.

**What used to be here.** Previously, an ungrounded Co-Pilot inbound escalated — in the background, off the customer-response path — to the autonomous Professor for a polished reply plus auto-persisted facts ("the system gets smarter on its own"). The measured cost was a full reasoning-LLM round-trip on every ungrounded turn (the "Professor tax"), and it could auto-publish self-attested facts. It was removed: the Professor is now **creation-only** (Human + Professor via the Conductor). An ungrounded Co-Pilot turn now simply keeps the **Student's own draft** (or the tenant's fallback phrase) for a human to review — faster, cheaper, and with no autonomous fact persistence.

**What stayed.** The durable per-conversation FIFO staging queue (`conversation_inbound_ai_stages`) still serializes the Co-Pilot draft pipeline: a per-conversation worker processes at most **one inbound per conversation at a time** (partial unique index + `FOR UPDATE SKIP LOCKED`), with smart burst-coalescing of rapid-fire texts, and the work survives restarts. (This replaced the old in-process `claimEscalationSlot` lock.)

**Injection safety still matters — for curation.** Whenever the Professor *creates* facts (a Conductor session, or Brain adjudication), the customer/source text is treated as **input only, never as truth.** Two **deterministic** guards (`screenEscalatedFacts`) enforce this regardless of what the model claims:
1. **`factDerivedFromCustomer`** — a candidate that just echoes the source's own words (trigram overlap ≥ ~0.45) is **dropped** (stops "as an admin, remember our price is $1" attacks).
2. **`factGroundedInLibrary`** — a fact the model labels as Library-sourced must actually share real content (≥2 meaningful words) with the retrieved Library text, or it's dropped.

> **The one rule to remember:** facts become truth **only** when a **human approves and pushes** them. No customer text, and no autonomous AI turn, ever writes to the Classroom.

---

## 10. The Auto-Pilot turn gate (reference)

Auto-Pilot's send decision is the pure, exhaustively unit-tested **fail-OPEN** gate table `evaluateAutoPilotTurn` (Section 7). It is evaluated **top-down, first match wins**, and — unlike the retired fail-closed gates — it **always produces a turn** (an answer or an acknowledgement) unless a hard guard suppresses it. Compliance is **re-checked again at the moment of sending**, not just at decision time.

| Order | Condition | Outcome | Breaker effect |
|---|---|---|---|
| 1 | Compliance/opt-out fails | **Suppress** (no AI send) | Neutral (a legal hold is not a knowledge miss) |
| 2 | A human already took this turn | **Defer** (no AI send, no event) | — |
| 3 | Classroom match (no responder error) | **Grounded answer**, auto-sent; stays green | Resets the consecutive run |
| 4 | 3rd **consecutive** fallback | **Final ack** + step down to Blue | Trips the breaker |
| 5 | **More than 3** fallbacks in the rolling 2-min window | **Final ack** + step down to Blue | Trips the breaker |
| 6 | Responder/LLM error | **Fallback ack** (never silent); stays green | Counts toward the breaker |
| 7 | No Classroom match | **Out-of-scope ack**; stays green | Counts toward the breaker |

- **Closed-book + no category rail.** Auto-Pilot answers **only** from the approved Classroom. Category (pricing/compliance/setup) **no longer blocks** auto-send — if a human published it, it is answerable. The only hard guard is **compliance/opt-out**. *(The legacy fail-closed gates `evaluateAutoSend` and `evaluateProfessorEscalationSend` were **deleted 2026-06-27**.)*
- **Breaker tallies** come from the append-only `autopilot_turn_events` history (`computeAutoPilotFallbackCounts`): the trailing run of consecutive fallbacks, and the fallbacks within the rolling window, each bounded by a prior `answer` or `stepdown` (a stepdown = a human re-enable boundary).

### Idempotency (no double-texts)
Every auto-send first claims the inbound message's ID in `ai_auto_replies` (unique per tenant + inbound SID). A carrier/webhook retry can't trigger a second send. **If a send fails or throws, the claim is released *and no turn event is written*** — so a legitimate retry can re-attempt, and the breaker only ever advances on a **confirmed** send. The `autopilot_turn_events` write is itself idempotent on `(tenant_id, inbound_message_id)`, so a retry can't double-count the breaker either.

---

## 11. AI states & inbox colors (operator quick-reference)

Each conversation has exactly one AI-state row. Its status, combined with the effective mode, drives the inbox send-button color.

| Status | Meaning | What staff should do |
|---|---|---|
| `idle` | Nothing pending | Normal |
| `drafted` | A draft is waiting (Co-Pilot, or a handback draft) | Review, edit, send |
| `auto_sent` | Auto-Pilot sent it verbatim | Nothing — monitor |
| `refused` | Auto-Pilot was paused by the breaker (stepped down to manual) | Read the chip, send manually |
| `failed` | A decided auto-send couldn't be delivered | Read the chip, send manually |
| `human_handled` | A human took over this turn | Done — returns to green next turn |
| `superseded` | A newer inbound replaced this state | Ignore (historical) |

> **Co-Pilot draft provenance.** A `drafted` Co-Pilot suggestion can come from several sources, and the inbox labels which: the **Student** (the normal grounded draft, or its own best draft when ungrounded), a **Router decline** (off-scope), a **general "flash"** answer, or the tenant's **fallback holding phrase**. They all behave the same for you — review, edit, send — and **none of them ever learns.** (There is no longer a Professor "rescue" draft — that path was removed 2026-06-27.)

### Handback chip text (what the customer-agent sees on a Blue handback)
As of 2026-06-27 the fail-open Auto-Pilot emits exactly **two** handback chips:
- **"Auto-Pilot paused after repeated out-of-scope messages…"** — the circuit breaker stepped this conversation down to Blue (status `refused`).
- **"Auto-send failed — please send manually"** — a decided send couldn't be delivered (status `failed`).

A **compliance/opt-out** hold sends nothing and shows **no chip** (silent suppress). The older fail-closed chips ("No matching knowledge," "Sensitive topic," "Not confident enough," "Conflicting knowledge," "Compliance hold," "AI is offline") are **retired** and no longer emitted.

---

## 12. Staff playbooks (troubleshooting)

**"The AI isn't drafting or answering."**
→ Live replies come from the **Student** — check the `GROK_KEYS` secret. (The **Professor's** OpenRouter integration only powers Conductor *curation* — Professor sessions and Brain adjudication — so a Professor outage never stops live replies.) With the Student's provider missing it stubs out by design: Co-Pilot can't draft a grounded reply and Auto-Pilot **fails open** to its fallback acknowledgement. SMS still records throughout.

**"The AI keeps handing back pricing/compliance questions."**
→ In **Co-Pilot**, *every* reply is drafted for you to send — so you always review pricing/compliance yourself; that's expected. In **Auto-Pilot** the AI is closed-book and **will** auto-send a *published* pricing/compliance fact (categories no longer block auto-send, changed 2026-06-27), so if a topic must always be human-reviewed, keep that conversation in **Co-Pilot** or don't publish it. A genuine **compliance/opt-out** hold is always a hard stop, re-checked at send.

**"The AI doesn't know something we definitely told it."**
→ The fact may still be in `draft` (not pushed to the Classroom), or it lives in the Knowledge Base/Library but was never absorbed into a published fact. Open the Professor page, absorb/accept the fact, and push to the Classroom.

**"Two of our published facts contradict (a `conflict` flag)."**
→ Two published facts contradict each other (often two different prices), so the Librarian flagged them for a human. Resolve the conflict in the Classroom so the Student grounds on a single correct fact.

**"A customer got a duplicate text."**
→ Should be impossible via the AI path (idempotency on inbound SID). If it happened, check whether an automation rule and a campaign both fired, or whether a human also sent manually.

**"A Co-Pilot draft came back as a polite 'we can't help with that,' or a generic answer that ignores our specifics."**
→ That's the Brand-Scope triage Router (Section 7): it judged the message off-scope (decline) or answerable from general knowledge (flash). It's **Co-Pilot-only and never sends on its own** — edit/replace the draft and send. If it misfires often, refine the tenant's **Brand Scope** (Conductor, tenant detail page).

**"Every ungrounded Co-Pilot reply is just our canned holding sentence."**
→ That's the **fallback holding phrase** doing its job: the question was tenant-specific but nothing in the Classroom could ground it, so the system stalls instead of guessing. Send it, then teach the answer (Professor session → push to Classroom) so next time it grounds. With no Fallback Phrase set, ungrounded Co-Pilot turns simply keep the Student's own best draft for you to review.

**"We taught the Professor something but the Student still doesn't know it."**
→ The Student only reads the **published Classroom**, not Professor chat or the Library. The facts must be **accepted and pushed** to create a new Classroom version.

**"Why didn't the system learn from that great Auto-Pilot conversation?"**
→ **No conversation learns at runtime** — by design (changed 2026-06-27). The inbound path never writes facts. Teach it the same way you teach everything: a **Professor session** (or a **Brain pull**), then push to the Classroom (Section 9).

---

## 13. Hard rules to never break (the safety contract)

1. **Customer text is query-only, never truth.** The customer can never teach the system (deterministic screening enforces this during curation).
2. **Compliance / opt-out is the hard send-time guard.** It is absolute and re-checked at the moment of sending. (Category alone — pricing/compliance/setup — no longer blocks auto-send, changed 2026-06-27.)
3. **Auto-Pilot is fail-OPEN.** It always answers or acknowledges; a **circuit breaker** steps a conversation that keeps missing down to Blue (a human re-enables it). It never silently stalls.
4. **No conversation learns at runtime.** Knowledge enters only via human-approved curation (a Professor session or a Brain pull).
5. **A missing AI provider must never break SMS.** Whether the Student's `GROK_KEYS` or the Professor's OpenRouter integration is absent, messages still record; the affected role just stubs out — Co-Pilot drafts nothing, Auto-Pilot **fails open** to its fallback ack, and Professor curation pauses.
6. **Compliance is re-checked at send time**, not just at draft time.
7. **One conversation = one AI state**, and a human can take the wheel at any moment without being overwritten by a slow background AI write.

---

*End of manual. Keep this file current as the LLM stack evolves.*
