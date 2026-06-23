# LLM Training Manual — Textitie (SAMA)

**Audience:** Textitie staff — platform operators (Conductors) and tenant-facing agents.
**Scope:** The complete LLM stack: the Professor, the Student, customer (SMS) interactions, the Student→Professor self-learning loop, the knowledge pipeline, the engagement modes, and every safety gate.
**How to read this:** Sections 1–4 are the mental model (read once). Sections 5–9 are the day-to-day mechanics. Sections 10–13 are reference tables and playbooks you will come back to.

> This is a living operational document. When the LLM behavior changes, update this file. The deep architecture-of-record lives in `README.md` and `replit.md`; this manual is the human-readable training layer on top of it.

---

## 1. The one-paragraph mental model

Every tenant (business) gets two AI workers. The **Student** is fast and cheap; it answers everyday customer texts using only the knowledge the business has already approved. The **Professor** is slow, smart, and expensive; it does two jobs — it helps the business *curate* knowledge (offline, with a human), and it *rescues* the Student in real time when a customer asks something the Student has never been taught. When the Professor rescues the Student and the answer is safe, the business *learns* it permanently so it never has to ask the Professor again. A human can take over **any** conversation at **any** time, and a strict set of fail-closed safety gates decides when (if ever) the AI is allowed to text a customer without a human pressing send.

---

## 2. Glossary (learn these words first)

| Term | Plain meaning |
|---|---|
| **Tenant** | A business/customer of Textitie. Everything is scoped per-tenant; no tenant ever sees another's data or knowledge. |
| **Conductor** | The platform operator (you, internal staff) using the SAMA Control Plane / admin app. |
| **Agent** | A tenant's own staff member working their SMS inbox. |
| **Customer / Contact** | The end consumer texting the tenant's number. |
| **Professor** | The heavy reasoning model (`grok-4.3`). Curates knowledge and rescues ungrounded questions. |
| **Student** | The fast model (`grok-4.20-0309-non-reasoning`). Drafts everyday replies from approved knowledge. |
| **Knowledge Base** | Raw uploaded material (PDFs, text, URLs). The intake bin. |
| **Library** | The Knowledge Base after it's been extracted and chunked for search. The Professor's reference shelf. |
| **Classroom** | The *published, approved* facts the Student is allowed to use. Versioned. |
| **Fact** | One atomic, categorized statement of truth (e.g., "The Pro plan is $50/month"). |
| **Grounded** | An answer is "grounded" when it is backed by a real Classroom fact, not a guess. |
| **Engagement mode** | How autonomous the AI is for a conversation: Manual / Co-Pilot / Auto-Pilot. |
| **Handback (Blue)** | The AI declines to send and hands the message to a human, with a one-line reason. |
| **Gate** | A fail-closed safety check that must pass before the AI sends anything by itself. |

---

## 3. The cast: Professor vs. Student

Both roles run on **Grok (xAI)** through its OpenAI-compatible API (`baseURL https://api.x.ai/v1`). The key lives in the `GROK_KEYS` secret.

| | **Student** | **Professor** |
|---|---|---|
| Model | `grok-4.20-0309-non-reasoning` (override: `SAMA_STUDENT_MODEL`) | `grok-4.3` (override: `SAMA_PROFESSOR_MODEL`) |
| Personality | Fast, cheap, literal | Slow, reasoning-heavy, expensive |
| Job 1 | Draft replies to inbound customer texts | Curate knowledge with a human (Professor sessions) |
| Job 2 | — | Rescue the Student live when it's ungrounded |
| Knowledge it can use | **Only the published Classroom** (+ legacy blob fallback) | The whole **Library** + its own general expertise |
| Can it "learn"? | No — never persists facts | Yes — its rescue facts can be learned (under strict conditions) |

> **Stub / offline behavior:** If `GROK_KEYS` is **unset**, both roles degrade to a harmless stub. Inbound SMS keeps working, messages still record, but the AI produces no draft and never auto-sends. This is intentional — **a missing key must never break message delivery.** If staff see "AI is offline" handbacks everywhere, the first thing to check is whether `GROK_KEYS` is set.

---

## 4. The 5-stage knowledge pipeline (big picture)

```
  (1) KNOWLEDGE BASE  →  (2) LIBRARY  →  (3) PROFESSOR  →  (4) CLASSROOM  →  (5) STUDENT
      raw uploads         searchable      human + AI         approved          answers live
      (PDF/text/URL)      chunks          curation           versioned facts   customer texts
```

- **Stages 1–4 are curation** (offline, human-in-the-loop, no customer is waiting).
- **Stage 5 is production** (a real customer is texting right now).
- The **self-learning loop** (Section 9) is the shortcut that lets stage 5 feed approved truth back into stage 4 automatically — but only when it's safe.

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

The Library is what the **Professor reads** during curation and during a live rescue. It is *not* what the Student reads — the Student only reads the Classroom.

### Stage 3 — Professor sessions (human-in-the-loop curation)
In the admin **Professor** page, a Conductor opens a **Memory Session** (max **5 active per tenant**) and chats with the Professor. The Professor answers using the Library + its own expertise. When an answer is good, the operator asks the Professor to **absorb** it — the Professor extracts **atomic facts** from its own answer. Each fact is:
- assigned a **category** (see below), and
- left in **`draft`** status for a human to **accept (✓)** or **reject (✕)**.

This is the quality gate where a human decides what becomes truth.

### Stage 4 — Classroom (the approved, versioned truth)
Accepted facts are **pushed to the Classroom**, which creates a new **Classroom version**. Only the **current published version** is visible to the Student. Old versions become `superseded` (kept for history, never read live).

Pushing isn't a blind copy — the **Librarian** adjudicates it first (Section 8).

#### Fact categories (memorize these — the gates depend on them)
| Category | Examples | Auto-send safe? |
|---|---|---|
| `general` | Hours, location, general info | ✅ Safe |
| `features` | What the product does | ✅ Safe |
| `pricing` | Prices, discounts, billing | ❌ **Always needs a human** |
| `compliance` | Legal, TCPA, consent, refunds | ❌ **Always needs a human** |
| `technical_setup` | Install/config steps that can break things | ❌ **Always needs a human** |

> **Why three categories are "risky":** money, law, and breakage. A wrong pricing/compliance/setup answer is expensive or dangerous, so the AI is *never* allowed to send those autonomously — it drafts them and a human sends. This is a hard rule, not a tunable.

#### Fact statuses
`draft` (new, awaiting human) → `published` (live in a Classroom version) → `conflict` (flagged as contradictory) ; plus `rejected` (a human said no).

### Stage 5 — Student (production)
When a real customer texts in, the Student reads the **current Classroom**, drafts a reply, and the engagement mode + gates decide what happens next. This is the whole of Section 6.

---

## 6. Customer interaction: the inbound SMS pipeline, step by step

This is the most important section for agents. When a customer text hits the tenant's number, here is the exact order of operations. Steps 1–3 happen **immediately** (on the path that returns `200 OK` to Twilio). Steps 4–7 happen **in the background, off that path** — so the AI's slow thinking never delays message receipt.

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

**Step 5 — Student drafts (if mode ≠ Manual and automation didn't handle it).**
- `retrieveClassroomFacts` pulls grounded facts from the current Classroom (full-text search, category-boosted — see Section 7).
- The Student is prompted to produce **four labeled sections**:
  1. **SUMMARY** — what the customer is asking.
  2. **DRAFT REPLY** — the proposed SMS.
  3. **KB MATCH** — which knowledge it used (or `none`).
  4. **CONFIDENCE** — `high` / `medium` / `low`.
- The reply's **`kbMatched`** flag is true only when KB MATCH is **not** `none`. This single flag decides whether we escalate to the Professor.

**Step 6 — Engagement mode decides the outcome** (full detail in Section 7).
- **Manual:** stop. No draft surfaced, no send, no learning.
- **Co-Pilot:** save the draft, pre-fill the agent's composer, wait for a human to edit & send.
- **Auto-Pilot:** run the gate. Pass → auto-send verbatim + learn. Fail → Blue handback for that one message.

**Step 7 — Professor escalation (only when the Student is ungrounded).**
- Triggered when the Student produced a draft **but `kbMatched` is false** — i.e., the customer asked something the Classroom doesn't cover.
- This is the self-learning loop. See Section 9.

---

## 7. Engagement modes (the agent's primary control)

Every conversation runs in one of **three** modes. The effective mode = the per-conversation override if set, otherwise the tenant default. (`resolveEffectiveEngagementMode`.) The DB default is **Co-Pilot**. Legacy names are auto-translated on save (`assisted`→Co-Pilot, `gated_auto`→Auto-Pilot); anything unrecognized falls back to Co-Pilot (the safe choice).

| Mode | Inbox color | AI drafts? | AI sends by itself? | AI learns? |
|---|---|---|---|---|
| **Manual** | 🔵 Blue | No | No | No |
| **Co-Pilot** | 🟡 Yellow | Yes | No (human sends) | No |
| **Auto-Pilot** | 🟢 Green | Yes | Yes, **if the gate passes** | Yes, **only on a clean autonomous send** |

### Manual (🔵)
AI is fully off for this conversation. No Student draft, no auto-send, no learning. A new inbound clears any pending AI state. Use this for sensitive or VIP conversations where you want zero AI involvement.

### Co-Pilot (🟡)
The Student drafts (and may consult the Professor *just to draft a better suggestion*), the draft is saved and **pre-filled into the composer**. A human edits and sends. **Co-Pilot never learns** — nothing a human touches is persisted as truth. This is the default and the safest "AI helps but doesn't act" setting.

> **New: streaming Co-Pilot drafts.** When the Professor is rescuing an ungrounded question in Co-Pilot, the customer-facing reply now **streams into the composer as it's written**, before the Professor finishes its slower fact-reasoning. The agent sees a usable draft sooner. (Auto-Pilot deliberately does *not* act early — its gate needs the fully screened facts and confidence first.)

### Auto-Pilot (🟢)
The Student drafts, then the **auto-send gate** runs:
- **Gate passes** → the reply is sent **verbatim** (exactly as drafted), and the facts are learned.
- **Gate refuses, OR Grok fails** → **Blue handback for that one message**: the AI state becomes `refused` / `failed`, a reason chip appears in the inbox, and **nothing is learned**. The conversation returns to green automatically after a human handles that message.

A human can step into any Auto-Pilot conversation at any time. The moment a human sends, that pending message is marked human-handled and **is not learned**.

#### Retrieval detail staff sometimes ask about
- The query's category (pricing/features/etc.) is used to **boost** ranking, **not to filter** — so a misclassified question can never hide a relevant fact.
- Full-text search first tries strict **AND** semantics (all words must match); if that returns nothing, it falls back to **OR** semantics so conversational, wordy questions still find facts.

---

## 8. The Librarian: keeping the Classroom clean

When facts are pushed to the Classroom (by a human **or** by the self-learning loop), the **Librarian** runs first so the Classroom never fills with duplicates or silent contradictions.

- **De-duplication:** near-identical facts are clustered by **trigram (3-character) similarity** (threshold ~0.30, tightened to ~0.18 for sensitive categories) and collapsed.
- **High-stakes contradiction catch:** if two facts mention the **same subject** (e.g., "Pro Plan") but **different numbers** (e.g., "$50" vs "$60"), they're forced into review even if the wording differs.
- **The model adjudicates each cluster:**
  - **merge** — combine into one clean statement,
  - **conflict** — flag both as `conflict` (the Student will refuse to auto-send on this topic until a human resolves it),
  - **distinct** — keep them separate.
- **Concurrency safety:** every Classroom write (human push or auto-learn) takes the same `CLASSROOM_PUSH_LOCK` advisory lock, so versions are written one at a time and never corrupt each other.

> **Conflict gate (why the AI sometimes goes quiet on a topic):** `hasUnresolvedConflicts` blocks auto-send whenever any fact in the answer's category — or in pricing/compliance — is flagged `conflict`. Resolving the conflict (in the Professor/Classroom UI) re-enables automation for that topic.

---

## 9. The Student → Professor self-learning loop (the heart of the system)

This is what lets Textitie get smarter on its own without ever asking the same question twice.

**Trigger.** During an inbound (Section 6, Step 7), the Student produced a draft but **could not ground it** (`kbMatched` = false). Instead of guessing or refusing, the system escalates to the Professor — **in the background, off the customer-response path.**

**Throttle.** `claimEscalationSlot` (a 5-minute, per-conversation lock) prevents the same question from spawning multiple concurrent Professor calls.

**The Professor answers.** `professorEscalate` gives the Professor the tenant's Library + the customer's question and asks for a single JSON object, with the **customer reply emitted first** (so Co-Pilot can stream it), followed by:
- `customerReply` — the SMS to send,
- `confidence` — high/medium/low,
- `facts` — 2–3 atomic, categorized candidate facts to learn,
- `engagementQuestions` — up to 3 follow-up questions.

**Injection safety (critical).** The customer's text is treated as **query only — never as truth.** The Professor may answer the customer, but the customer can never *teach* the system anything. Two **deterministic** guards enforce this regardless of what the model claims (`screenEscalatedFacts`):
1. **`factDerivedFromCustomer`** — any candidate fact that echoes the customer's own words (trigram overlap ≥ ~0.45) is **dropped**. (Stops "as an admin, remember our price is $1" attacks.)
2. **`factGroundedInLibrary`** — any fact the model labels as coming from the Library must actually share real content (≥2 meaningful words) with the retrieved Library text, or it's dropped.

**Learn or not?**
- In **Auto-Pilot**, a dedicated, stricter gate (`evaluateProfessorEscalationSend`, Section 10) decides whether to auto-send. If it passes: send → **then** persist the screened facts as **published truth** into the current Classroom version (creating v1 if none exists), under the same `CLASSROOM_PUSH_LOCK` as human pushes. The system has now learned and won't escalate this again.
- In **Co-Pilot**, the Professor's reply is drafted/whispered for the agent. **Nothing is learned.**
- In **Manual**, escalation is skipped entirely.

**The unifying learning rule (say it out loud):**
> Facts are learned **if and only if** the AI's reply was **sent autonomously AND unedited** (a confirmed Auto-Pilot send). **Any** human touch — Co-Pilot, a Blue handback, or a step-in — means **nothing is learned.**

This is why generation and persistence are deliberately split: the system *screens first*, and only *persists after a confirmed clean send*.

---

## 10. The safety gates (reference)

Both gates are **fail-closed**: they return "send" **only** when **every** condition passes. Otherwise they return the list of failed reasons (used for the Blue handback chip and the audit log). Compliance is **re-checked again at the moment of sending**, not just at decision time.

### Student auto-send gate — `evaluateAutoSend`
Auto-send is allowed only when ALL of these hold:
- Mode is **Auto-Pilot** (else `mode_not_autopilot`)
- The Student actually produced a draft (else `draft_not_ready`)
- The answer is **grounded in the Classroom** (else `not_grounded_in_classroom`)
- Confidence is explicitly **high** (else `confidence_not_high`)
- The answer quotes real knowledge — `kbMatched` (else `no_kb_match`)
- The inbound intent is **not** a risky category (pricing/compliance/setup) (else `risky_query_category`)
- Grounding facts exist (else `no_grounding_facts`) **and** are all in safe categories (else `unsafe_grounding_category`)
- No unresolved conflict on the topic (else `unresolved_conflict`)
- Telephony compliance passes (else `compliance_block`)

### Professor escalation auto-send gate — `evaluateProfessorEscalationSend`
The Professor produced fresh grounding, so this skips the Student's KB gate — but **never** the safety floors:
- Mode is **Auto-Pilot** (else `mode_not_autopilot`)
- Automation didn't already handle it (else `automation_handled`)
- Grok is configured/online (else `grok_offline`)
- The escalation actually got answered (else `escalation_not_answered`)
- Confidence is **high** (else `confidence_not_high`)
- At least one fact survived screening (else `no_screened_facts`)
- There is a non-empty reply (else `no_reply_text`)
- Escalated facts exist (else `no_escalated_categories`) **and** are all in safe categories (else `unsafe_escalated_category`)
- The inbound intent is **not** risky (else `risky_query_category`)
- No unresolved conflict (else `unresolved_conflict`)
- Compliance passes (else `compliance_block`)

### Idempotency (no double-texts)
Every auto-send first claims the inbound message's ID in `ai_auto_replies` (unique per tenant + inbound SID). A carrier/webhook retry can't trigger a second send. **If a send fails, the claim is released** so a legitimate retry can re-attempt — a failed send must never permanently dead-letter the conversation.

---

## 11. AI states & inbox colors (operator quick-reference)

Each conversation has exactly one AI-state row. Its status, combined with the effective mode, drives the inbox send-button color.

| Status | Meaning | What staff should do |
|---|---|---|
| `idle` | Nothing pending | Normal |
| `drafted` | A draft is waiting (Co-Pilot, or a handback draft) | Review, edit, send |
| `auto_sent` | Auto-Pilot sent it verbatim | Nothing — monitor |
| `refused` | Gate declined to auto-send | Read the chip, send manually |
| `failed` | Grok or the send failed | Read the chip, send manually |
| `human_handled` | A human took over this turn | Done — returns to green next turn |
| `superseded` | A newer inbound replaced this state | Ignore (historical) |

### Handback chip text (what the customer-agent sees on a Blue handback)
The most important reason wins. Common chips:
- "AI couldn't draft a reply" · "Auto-send failed — please send manually"
- "Compliance hold — needs your review" · "Sensitive topic — needs a human"
- "Conflicting knowledge — needs your review" · "Not confident enough to auto-send"
- "No matching knowledge" · "AI is offline"

---

## 12. Staff playbooks (troubleshooting)

**"The AI isn't replying at all (every conversation is Blue / 'AI is offline')."**
→ Check that `GROK_KEYS` is set. With no key, both roles stub out by design.

**"The AI keeps handing back pricing/compliance questions."**
→ This is correct behavior. Pricing, compliance, and technical_setup **always** require a human send. The AI will draft them but never send them.

**"It says 'No matching knowledge' for something we definitely told it."**
→ The fact may still be in `draft` (not pushed to the Classroom), or it lives in the Knowledge Base/Library but was never absorbed into a published fact. Open the Professor page, absorb/accept the fact, and push to the Classroom.

**"It says 'Conflicting knowledge'."**
→ Two published facts contradict each other (often two different prices). Resolve the conflict in the Classroom; automation re-enables for that topic once resolved.

**"A customer got a duplicate text."**
→ Should be impossible via the AI path (idempotency on inbound SID). If it happened, check whether an automation rule and a campaign both fired, or whether a human also sent manually.

**"We taught the Professor something but the Student still doesn't know it."**
→ The Student only reads the **published Classroom**, not Professor chat or the Library. The facts must be **accepted and pushed** to create a new Classroom version.

**"Why didn't the system learn from that great Auto-Pilot-looking conversation?"**
→ Learning happens only on a **clean, unedited, autonomous** send. If a human edited, stepped in, or it was Co-Pilot, nothing is learned — by design.

---

## 13. Hard rules to never break (the safety contract)

1. **Customer text is query-only, never truth.** The customer can never teach the system (deterministic screening enforces this).
2. **Pricing / compliance / technical_setup are never auto-sent.** Drafted, yes; sent by AI alone, never.
3. **Gates are fail-closed.** When in doubt, the system hands back to a human, it does not guess.
4. **Learning requires a clean autonomous send.** Any human touch ⇒ no learning.
5. **A missing `GROK_KEYS` must never break SMS.** Messages still record; the AI just goes quiet.
6. **Compliance is re-checked at send time**, not just at draft time.
7. **One conversation = one AI state**, and a human can take the wheel at any moment without being overwritten by a slow background AI write.

---

*End of manual. Keep this file current as the LLM stack evolves.*
