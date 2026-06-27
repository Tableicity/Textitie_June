# LLM How-To — Staff Training Guide (Textitie / SAMA)

**Audience:** Textitie staff — platform operators (**Conductors**) working the SAMA Control Plane, and tenant-facing **agents** working an SMS inbox.
**Purpose:** A *granular, do-this-then-that* companion to the conceptual [`LLM Training Manual.md`](../LLM%20Training%20Manual.md). The manual explains **why** the AI behaves the way it does; this guide explains **exactly how** to operate it, step by step.
**How to use this guide:** Find your task in the Table of Contents, jump to it, and follow the numbered steps. Each procedure is self-contained. Boxes marked **⚠️ Safety** are hard rules you must not work around.

> This is a **living operational document**. Whenever the system or a procedure changes, update the relevant section **and** add a row to the [Revision History](#16-revision-history) at the bottom. See [§15 — How to update this document](#15-how-to-update-this-document-revision-control) for the rules.

---

## Document control (at a glance)

| Field | Value |
|---|---|
| **Document** | `LLM_How_To_Training.md` |
| **Location** | `John/LLM How To/` |
| **Current version** | **v3.0** |
| **Last updated** | 2026-06-27 |
| **Owner** | Platform / Conductor team |
| **Companion docs** | `John/LLM Training Manual.md` (concepts), `John/Run_Book.md` (Twilio go-live & secrets), `replit.md` (architecture of record) |
| **Review cadence** | Review every release that touches the LLM stack; minimum quarterly |

---

## Table of contents

1. [Before you start — access & roles](#1-before-you-start--access--roles)
2. [The 60-second mental model](#2-the-60-second-mental-model)
3. [How to load a tenant's knowledge (Knowledge Base → Library)](#3-how-to-load-a-tenants-knowledge-knowledge-base--library)
4. [How to run a Professor memory session](#4-how-to-run-a-professor-memory-session)
5. [How to accept/reject facts and push to the Classroom](#5-how-to-acceptreject-facts-and-push-to-the-classroom)
   - [5a. How to pull a tenant's knowledge from Brain (Conductor)](#5a-how-to-pull-a-tenants-knowledge-from-brain-conductor)
6. [How to resolve a knowledge conflict](#6-how-to-resolve-a-knowledge-conflict)
7. [How to set the engagement mode (tenant default + per-conversation)](#7-how-to-set-the-engagement-mode-tenant-default--per-conversation)
   - [7a. How to set Brand Scope & the Fallback Phrase (Conductor)](#7a-how-to-set-brand-scope--the-fallback-phrase-conductor)
8. [How to work the inbox (Co-Pilot, Auto-Pilot, stepping in)](#8-how-to-work-the-inbox-co-pilot-auto-pilot-stepping-in)
9. [How to read inbox colors & AI-state chips](#9-how-to-read-inbox-colors--ai-state-chips)
10. [How to handle a handback or a step-down](#10-how-to-handle-a-handback-or-a-step-down)
11. [Why no conversation learns at runtime (knowledge is human-curated)](#11-why-no-conversation-learns-at-runtime-knowledge-is-human-curated)
12. [How to handle opt-outs (STOP / START)](#12-how-to-handle-opt-outs-stop--start)
13. [Troubleshooting playbooks](#13-troubleshooting-playbooks)
14. [Hard safety rules (never break these)](#14-hard-safety-rules-never-break-these)
15. [How to update this document (revision control)](#15-how-to-update-this-document-revision-control)
16. [Revision history](#16-revision-history)

---

## 1. Before you start — access & roles

There are **two separate apps and two separate user systems**. Know which one you are in.

| You are a… | You use… | At… | You can… |
|---|---|---|---|
| **Conductor** (Textitie staff) | SAMA Control Plane (admin app) | `/admin/` | Manage tenants, run Professor sessions, curate knowledge, provision numbers, monitor webhooks |
| **Agent** (a tenant's staff) | Agent app (user app) | `/inbox` and the tenant pages (`/contacts`, `/settings`, `/knowledge`, …) | Work that tenant's SMS conversations and knowledge |

**Steps to get oriented:**
1. Confirm which role you hold. Conductor logins and agent logins are **different accounts** — they are not interchangeable.
2. Conductors: open the Control Plane and select the **tenant** you are working on first. Everything is scoped per-tenant; you can never affect another tenant by accident.
3. Agents: open `/inbox`. Your conversations are already scoped to your business.

> **⚠️ Safety:** Never share or paste credentials, API keys, or secret values into a conversation, a ticket, or this document. Secrets live only in the platform's secret store (see `John/Run_Book.md`).

---

## 2. The 60-second mental model

- Every business (**tenant**) gets two AI workers: a fast **Student** that answers everyday texts from *approved* knowledge, and a slow, smart **Professor** that curates knowledge **with a human**. The Professor is **not** on any live customer-reply path — its old real-time "rescue" of the Student was **removed 2026-06-27**.
- Knowledge flows through five stages: **Knowledge Base → Library → Professor → Classroom → Student.** Only the **Classroom** (approved, published facts) is what the Student is allowed to use with customers.
- Each conversation runs in one of three **engagement modes**: **Manual** (AI off), **Co-Pilot** (AI drafts, human sends), **Auto-Pilot** (AI replies on its own — **answering or acknowledging every turn** — with a **circuit breaker** that steps a conversation down to a human if it keeps coming up empty).
- In **Co-Pilot**, two optional Conductor settings shape the draft (both only ever *draft*, never send/learn): a **Brand Scope** (off-topic questions get a polite decline, general questions get a quick general answer) and a **Fallback Phrase** (a holding reply drafted when a tenant-specific question can't be grounded). See §7a.
- Besides Professor sessions, a Conductor can also **pull knowledge from the external Brain service** — same review-and-push, same Classroom (§5a).
- A human can take over **any** conversation at **any** time.
- **No conversation learns at runtime** — not even Auto-Pilot. Knowledge enters the Classroom **only** when a human approves it (a Professor session or a Brain pull). See §11.

If you remember nothing else: **the Student only knows what's been pushed to the Classroom, the only hard stop on an auto-send is compliance/opt-out, and no live conversation ever teaches the system.**

---

## 3. How to load a tenant's knowledge (Knowledge Base → Library)

**Goal:** Get raw business material into the system so the Professor can use it.

1. Open the tenant's **Knowledge** area (agent app `/knowledge`, or the Control Plane knowledge view for that tenant).
2. Add source material. Supported inputs:
   - **Files:** PDF, TXT, MD, CSV.
   - **Pasted text.**
   - **URLs** (public pages only).
3. Submit. The system will:
   - Extract text (PDF text is pulled automatically).
   - Split it into ~1,800-character **chunks** on paragraph boundaries.
   - Index it for full-text search (the **Library**).
4. Confirm the upload appears in the Library list.

> **Note on URLs:** Internal/private URLs are **deliberately blocked** for security. If a URL is rejected, that is expected — host the content somewhere public or paste the text instead.

> **⚠️ Important:** Uploading to the Library does **not** make the Student smarter yet. The Library is only the *Professor's* reference shelf. The Student learns only after facts are **absorbed, accepted, and pushed to the Classroom** (§4–§5).

> **Alternative intake (Conductor):** Instead of — or in addition to — manual uploads, a Conductor can pull knowledge from the external **Brain** service. It lands in the same candidate pool and is pushed the same way. See §5a.

---

## 4. How to run a Professor memory session

**Goal:** Turn Library material into clean, atomic candidate facts. **Conductor task, in the Control Plane Professor page.**

1. Open the **Professor** page in the Control Plane and select the tenant.
2. Start a **Memory Session.** (Limit: **5 active sessions per tenant** — close finished ones.)
3. Ask the Professor a real customer-style question (e.g., "What's included in the Pro plan?"). It answers using the Library + its own expertise.
4. Review the answer for accuracy. If it's wrong or thin, refine your question or add more Library material (§3) and try again.
5. When the answer is good, tell the Professor to **absorb** it. The Professor extracts **atomic facts** from its own answer — one statement of truth each.
6. Each extracted fact arrives in **`draft`** status with a **category** auto-assigned. Categories:

   | Category | Examples | Notes |
   |---|---|---|
   | `general` | Hours, location, general info | Routine |
   | `features` | What the product does | Routine |
   | `pricing` | Prices, discounts, billing | High-stakes — verify before publishing |
   | `compliance` | Legal, TCPA, consent, refunds | High-stakes — verify before publishing |
   | `technical_setup` | Install/config steps that can break things | High-stakes — verify before publishing |

7. Proceed to §5 to accept/reject these drafts.

> **Why these categories matter:** money, law, and breakage. Give `pricing` / `compliance` / `technical_setup` facts extra scrutiny **before you publish** — once published, Auto-Pilot (closed-book) may quote them verbatim, and the Librarian dedups these topics more tightly. **Changed 2026-06-27:** category alone no longer *blocks* auto-send; the only hard send-time guard is compliance/opt-out. To keep a topic always human-reviewed, run that conversation in **Co-Pilot**.

---

## 5. How to accept/reject facts and push to the Classroom

**Goal:** Decide what becomes truth, then publish it so the Student can use it.

1. In the Professor page, review each **`draft`** fact.
2. For each fact:
   - **Accept (✓)** if it is correct, atomic, and safe to store.
   - **Reject (✕)** if it is wrong, duplicated, or off-topic.
3. When you've accepted the facts you want, **Push to Classroom.** This:
   - Runs the **Librarian** first (it de-duplicates near-identical facts and flags contradictions — see §6).
   - Creates a **new Classroom version.** Only the **current published version** is visible to the Student; older versions become `superseded` history.
4. Verify: the accepted facts now show **`published`** status in the current Classroom version.

**Checkpoint — did it actually take effect?** Ask the Student-facing path a test question (or watch a real inbound). If the answer still doesn't reflect the new fact (the Student stays out-of-scope), it's probably still in `draft` or was never pushed — repeat steps 2–3.

> **⚠️ Safety:** Accepting a fact is a *truth decision.* Double-check pricing and compliance facts against the source material before accepting — once published, the Student may quote them.

---

## 5a. How to pull a tenant's knowledge from Brain (Conductor)

**Goal:** Load knowledge from the external **Brain** service into a tenant's pipeline without running a Professor session. **Conductor task, in the Control Plane Brain page (`/admin/brain`).** *"Brain + Human" mirrors "Human + Professor"* — the facts land in the same pool and ride the same Classroom push.

> **Prerequisite:** The Brain service must be configured. If the page reports the service is unavailable, the connection isn't set up yet — tell a platform admin. The feature stays safely dormant until then.

1. Open the **Brain** page in the Control Plane and select the tenant.
2. Press **Pull** to harvest candidates from Brain. This is synchronous — wait for it to finish. The system:
   - Stages each harvested statement as a **`draft`** candidate (the *same* pool Professor facts use).
   - **De-duplicates** exact/normalized repeats on pull (deeper semantic de-duplication happens later, at the Classroom push).
   - **Flags contradictions with a reason** — these render **unchecked** so you can't promote them by accident. (Deeper semantic conflict adjudication also happens at push.)
3. Review the **candidates**. For each one:
   - Confirm it is correct and on-topic.
   - Fix the **category** if it is wrong (it guides curation scrutiny and Librarian dedup — see §4).
   - Leave flagged/contradictory candidates unchecked unless you have verified them.
4. Select the candidates you want and press **Push.** This:
   - Validates every selected item is a real Brain candidate **for this tenant** — it refuses the **whole** push if any isn't (no partial promote).
   - Promotes them to **`published`** and snapshots a **new Classroom version** — always a full union of *every* published fact (Professor **and** Brain), so a Brain push never wipes Professor facts, and vice-versa.
5. Verify exactly as you would after a Professor push (§5): the facts show **`published`**, and the Student can now ground that topic.

> **⚠️ Safety:** Brain content is *candidate* knowledge, not auto-truth. A human (you) still accepts each fact and owns the truth decision — especially for `pricing` / `compliance` / `technical_setup`.

---

## 6. How to resolve a knowledge conflict

**Goal:** Clear a `conflict` flag so the Student never grounds an answer on contradictory facts.

**Why conflicts happen:** When two published facts mention the **same subject** but **different numbers** (e.g., "Pro plan is $50" vs "$60"), the Librarian flags both as `conflict` so a human resolves which is true. Leaving a contradiction in the Classroom risks the Student grounding an answer on the wrong number.

1. In the Professor / Classroom view, find facts marked **`conflict`**.
2. Identify the correct statement (check the source material).
3. **Reject** the wrong fact and **keep** the correct one — or edit/re-absorb a single correct fact (§4–§5).
4. **Push to Classroom** again to publish the resolution.
5. Confirm the `conflict` flag is gone and the Classroom now holds a single correct fact for that topic.

> **Tip:** A burst of `conflict` flags after a push usually means it introduced a contradicting price or policy. Resolve at the source (keep the correct fact) rather than rejecting one side blindly. Conflicts are a **Classroom curation flag** — they no longer produce an inbox handback.

---

## 7. How to set the engagement mode (tenant default + per-conversation)

**Goal:** Control how autonomous the AI is — for a whole business, or for a single conversation.

There are two levels:
- **Tenant default** — applies to every conversation that has no override. **DB default is Co-Pilot.**
- **Per-conversation override** — wins over the tenant default for just that one conversation. Clearing it makes the conversation inherit the tenant default again.

**Set the tenant default (agent app `/settings`, or Control Plane):**
1. Open the tenant's settings.
2. Choose the default engagement mode: **Manual**, **Co-Pilot**, or **Auto-Pilot**.
3. Save. New conversations without an override now use this.

**Set a per-conversation override (in the inbox):**
1. Open the conversation.
2. Use the engagement-mode control on the conversation to pick **Manual / Co-Pilot / Auto-Pilot**.
3. To go back to the business default, **clear** the override.

| Mode | Inbox color | AI drafts? | AI sends itself? | AI learns? | Use it for… |
|---|---|---|---|---|---|
| **Manual** | 🔵 Blue | No | No | No | VIP/sensitive conversations; zero AI |
| **Co-Pilot** | 🟡 Yellow | Yes | No (human sends) | No | The safe default — AI assists, human acts |
| **Auto-Pilot** | 🟢 Green | Yes | **Yes — answers or acks every turn** (fail-open + breaker) | **No — never learns** | High-volume, well-covered topics |

> **Note:** Old mode names are auto-translated on save (`assisted` → Co-Pilot, `gated_auto` → Auto-Pilot). Anything unrecognized safely falls back to **Co-Pilot**.

---

## 7a. How to set Brand Scope & the Fallback Phrase (Conductor)

**Goal:** Tune how **Co-Pilot** behaves for a tenant. Both settings are **Conductor-only**, live on the tenant's detail page, and affect **Co-Pilot only** — Auto-Pilot and Manual ignore them. Both **fail open**: leave either blank and Co-Pilot behaves exactly as before.

**Where:** Control Plane → **Tenants** → open the tenant (`/admin/tenants/:id`) → the **Brand Scope** and **Fallback Phrase** cards.

### Brand Scope (powers the triage Router)
1. In the **Brand Scope** card, write 1–3 sentences describing what the business is and what it answers (e.g., *"We're an HVAC parts supplier. We help with part numbers, compatibility, stock, and orders."*).
2. **Save.**
3. What it does: in Co-Pilot, every inbound is first sorted against this blurb into:
   - **Off-scope** (clearly unrelated) → Co-Pilot drafts a short, polite **decline** for a human to send.
   - **General, in-domain** → Co-Pilot drafts a quick **general-knowledge** answer (no Classroom/Professor lookup).
   - **Tenant-specific / unsure** → the **normal grounded pipeline** (the Router never blocks a real answer — when unsure it always picks this).

> **Tip:** Keep the Brand Scope tight and accurate. Too narrow and in-domain questions get declined; too broad and off-topic spam gets a general answer. It only ever *drafts* — a human still sends — so mistakes are cheap to fix.

### Fallback Phrase (the ungrounded holding reply)
1. In the **Fallback Phrase** card, write one on-brand "holding" sentence for when Co-Pilot can't ground a tenant-specific question (e.g., *"Great question — let me check on that and get right back to you."*).
2. **Save.**
3. What it does: in Co-Pilot, when an inbound reaches the grounded pipeline but has **no Classroom/KB match** (typically a question that needs this business's specific facts), Co-Pilot drafts this phrase **verbatim** (instead of guessing). A human sends the stall, then teaches the real answer (§4–§5) so it's grounded next time.

> **⚠️ Safety:** The fallback is a *stall, not an answer.* It exists so the AI never guesses at brand-specific pricing/policy/account facts. Leaving it blank simply means Co-Pilot keeps the **Student's own best draft** for an ungrounded question — there is no Professor rescue (that path was removed 2026-06-27).

---

## 8. How to work the inbox (Co-Pilot, Auto-Pilot, stepping in)

**Working a Co-Pilot (🟡) conversation:**
1. A customer texts in; the Student writes a draft and **pre-fills your composer.**
2. Read the draft. Edit anything you want.
3. Press **Send.** (Co-Pilot **never** learns — your edits and sends are never stored as truth.)

> **Heads-up — a Co-Pilot draft can come from different places.** Besides the Student's normal grounded draft, in Co-Pilot you may see: a **polite decline** (the Brand-Scope Router judged the message off-scope), a **quick general answer** (in-domain but answerable from general knowledge), or your tenant's **fallback holding phrase** (a tenant-specific question that couldn't be grounded). All of them are just drafts — review, edit, and send as normal; none ever sends itself or learns. See §7a to tune these.

**Monitoring an Auto-Pilot (🟢) conversation:**
1. On a Classroom match, the AI **sends a grounded reply verbatim** (status `auto_sent`) and stays green. No action needed — just monitor.
2. When it can't ground a turn, it sends a graceful **acknowledgement** and stays green — the customer is never left hanging. If a conversation keeps coming up empty, the **circuit breaker** trips: it sends a final ack and **steps the conversation down to Blue.** Pick it up manually (§10) and re-enable Auto-Pilot once you've trained the missing knowledge.
3. A **failed send** surfaces Blue for that turn (status `failed`) with the "Auto-send failed…" chip — handle it manually (§10). A **compliance/opt-out** hold is different: it's a **silent suppress** — nothing is sent, **no chip, no draft** — so just treat the inbound like any normal message.

**Stepping into any conversation (works in any mode):**
1. Open the conversation and just send a message yourself.
2. The pending AI turn is marked **`human_handled`** and **is not learned.**
3. You have the wheel; the background AI will not overwrite what you sent.

> **⚠️ Safety:** Auto-Pilot is **closed-book** — it only ever sends facts a human published. Category alone no longer blocks an auto-send (changed 2026-06-27); the hard stop is **compliance/opt-out**, re-checked at send. If a topic must always be human-reviewed, run that conversation in **Co-Pilot**.

---

## 9. How to read inbox colors & AI-state chips

**Colors (effective engagement mode):**
- 🔵 **Blue** — AI off for this turn (Manual, or a handback for one message).
- 🟡 **Yellow** — Co-Pilot: a draft is ready for you to send.
- 🟢 **Green** — Auto-Pilot: the AI replies on its own every turn — a grounded answer or a graceful ack.

**AI-state status → what to do:**

| Status | Meaning | Your action |
|---|---|---|
| `idle` | Nothing pending | Normal |
| `drafted` | A draft is waiting (Co-Pilot or handback) | Review, edit, send |
| `auto_sent` | Auto-Pilot sent it verbatim | Nothing — monitor |
| `refused` | Auto-Pilot was paused by the breaker (stepped down to manual) | Read the chip, send manually |
| `failed` | A decided auto-send couldn't be delivered | Read the chip, send manually |
| `human_handled` | A human took this turn | Done — returns to green next turn |
| `superseded` | A newer inbound replaced this | Ignore (historical) |

> **Note:** In Co-Pilot, a `drafted` suggestion may be the Student's grounded draft (or its own best draft when ungrounded), a Brand-Scope Router decline/flash answer, or the fallback holding phrase (§7a). They all behave identically — review, edit, send. (There is no longer a Professor "rescue" draft — removed 2026-06-27.)

---

## 10. How to handle a handback or a step-down

Since the **2026-06-27** fail-open change, Auto-Pilot **rarely** hands a single message back — on a knowledge miss it sends a graceful **acknowledgement** and stays green. There are now exactly **two** Blue handback chips you can see:

| Chip you see | Status | What it means | What to do |
|---|---|---|---|
| **"Auto-Pilot paused after repeated out-of-scope messages…"** | `refused` | The **circuit breaker** tripped — the conversation kept coming up empty, so Auto-Pilot sent a final ack and stepped it down to Blue | Reply manually, then teach the missing knowledge (§3–§5). **Re-enable Auto-Pilot** once it's covered — the step-down is *not* auto-cleared. |
| **"Auto-send failed — please send manually"** | `failed` | A send the AI decided to make couldn't be delivered (an infrastructure failure, **not** a knowledge miss) | Send manually; the system already freed the retry lock and recorded **no** breaker event. Any stitched answer is kept as a draft for you. |

**Two things that do *not* produce a chip:**
- **Compliance / opt-out hold.** A blocked send is a **silent suppress** — no chip, no draft. The turn is recorded for audit (neutral to the breaker), the conversation simply isn't auto-answered, and you handle it like any normal inbound. (Opt-outs are enforced upstream and re-checked at send.)
- **AI provider down.** If the Student's provider is unconfigured, Auto-Pilot **fails open** and still sends its fallback acknowledgement (stays green) — it does **not** show an "offline" chip. SMS always records. A Conductor restores live drafting by setting `GROK_KEYS` (§13).

> **Gone since 2026-06-27:** the old per-message handback chips for *"Sensitive topic,"* *"Not confident enough,"* *"No matching knowledge,"* *"Conflicting knowledge,"* *"Compliance hold,"* and *"AI is offline."* They came from the retired fail-closed gates and are no longer emitted. Auto-Pilot is now closed-book and fail-open: an unknown question gets an out-of-scope **ack** (green), not a handback, until the breaker steps in.

---

## 11. Why no conversation learns at runtime (knowledge is human-curated)

**The rule:** **no engagement mode learns from a live conversation** — not Co-Pilot, not Auto-Pilot. The inbound SMS path never writes a fact. This changed **2026-06-27**, when the live Professor escalation / self-learning loop was removed.

**What this means for you:**
- An **unknown question** no longer teaches the system on its own. In **Co-Pilot** the Student drafts its best answer (or the fallback phrase) for you to review; in **Auto-Pilot** it sends a graceful out-of-scope **ack** and stays green (until the breaker steps it down).
- The **Professor is creation-only** now: it helps you curate knowledge offline, with a human. It is **not** consulted on any live customer reply.

**How knowledge actually gets in — the only two ways (both human-approved):**
1. **Professor session** → accept facts → **push to Classroom** (§4–§5).
2. **Brain pull** → review candidates → **push to Classroom** (§5a).

**How to "teach" the AI a missing answer (the new playbook):**
1. Note the question the AI couldn't ground (a Co-Pilot fallback draft, an Auto-Pilot ack, or a breaker step-down).
2. Run a **Professor session** (§4) or a **Brain pull** (§5a) covering that topic.
3. **Accept** the correct facts and **push to Classroom** (§5).
4. Verify: open the **Classroom**, confirm the new **published** fact, then re-ask — the Student should now ground it directly.

> **⚠️ Safety (still true):** during curation, the source/customer text is treated as **input only, never as truth** — deterministic screening drops any "fact" that just echoes the asker or isn't supported by the Library. A customer can never *teach* the system.

---

## 12. How to handle opt-outs (STOP / START)

Opt-outs are handled **automatically before the AI ever runs** — but staff must understand the behavior:

- A customer texting **STOP / QUIT / UNSUBSCRIBE** (and similar): the system records the opt-out, sends a TCPA confirmation, and **closes** the conversation. The AI does **not** run.
- A customer texting **START**: the opt-out is removed (resubscribe).
- An **already-opted-out** sender is ignored (no duplicate confirmations).

**⚠️ Safety — what staff must NOT do:**
1. Never manually message a contact who has opted out. Respect the opt-out list.
2. If a customer asks to opt back in, have **them** text START — do not force a resubscribe on their behalf.
3. If you suspect an opt-out wasn't honored, escalate to a Conductor immediately (compliance issue).

---

## 13. Troubleshooting playbooks

**"The AI isn't drafting or answering."**
→ A Conductor should check that the AI key (`GROK_KEYS`) is set. With no key, the Student stubs out by design — Co-Pilot can't draft and Auto-Pilot **fails open** to its fallback ack — but **SMS still works** and messages are recorded.

**"Should Auto-Pilot really be answering pricing / compliance questions on its own?"**
→ Since 2026-06-27, category no longer blocks an auto-send — if a human **published** the fact, Auto-Pilot (closed-book) may quote it. The only hard send-time guard is **compliance/opt-out**. To keep a topic always human-reviewed, run that conversation in **Co-Pilot** (or don't publish that fact).

**"The AI doesn't know something we definitely told it."**
→ The fact is probably still in `draft`, or it's in the Library but was never absorbed/pushed. Run a Professor session, accept the fact, and push to the Classroom (§4–§5).

**"Two of our facts contradict (a 'conflict' flag)."**
→ Two published facts contradict (often two prices), so the Librarian flagged them for a human. Resolve in the Classroom (§6) so the Student grounds on a single correct fact.

**"A customer got a duplicate text."**
→ The AI path is protected against this (one send per inbound). If it happened, check whether an automation rule **and** a campaign both fired, or whether a human also sent manually.

**"A Co-Pilot draft is a polite 'we can't help with that,' or a generic answer that ignores our specifics."**
→ That's the Brand-Scope triage Router (§7a): it judged the message off-scope (decline) or answerable from general knowledge (flash). It's Co-Pilot-only and never sends itself — edit/replace and send. If it misfires often, refine the tenant's **Brand Scope**.

**"Every ungrounded Co-Pilot reply is just our canned holding sentence."**
→ That's the **fallback phrase** (§7a) doing its job: the question was tenant-specific but nothing in the Classroom could ground it, so the system stalls instead of guessing. Send it, then teach the answer (§4–§5) so next time it grounds. Clear the tenant's **Fallback Phrase** and Co-Pilot instead keeps the Student's own best draft for ungrounded questions (there is no Professor rescue — removed 2026-06-27).

**"We taught the Professor something but the Student still doesn't know it."**
→ The Student only reads the **published Classroom** — not Professor chat or the Library. Accept and **push** the facts to create a new Classroom version.

**"Why didn't it learn from that great Auto-Pilot conversation?"**
→ **No conversation learns at runtime** (changed 2026-06-27) — not even a clean Auto-Pilot send. Knowledge enters the Classroom only through human-approved curation: a Professor session (§4–§5) or a Brain pull (§5a). See §11.

---

## 14. Hard safety rules (never break these)

1. **Customer text is a question, never truth.** Customers can never teach the system.
2. **Compliance / opt-out is the only hard send-time guard** — re-checked at the moment of sending. Category no longer blocks an auto-send (changed 2026-06-27); use Co-Pilot to force human review of a topic.
3. **Auto-Pilot is closed-book and fail-open.** It answers from the approved Classroom or sends a graceful ack — never a guess — and a **circuit breaker** steps a stuck conversation down to a human (Blue).
4. **No conversation learns at runtime.** Knowledge enters the Classroom only through human-approved curation (a Professor session or a Brain pull).
5. **A missing AI key must never break SMS.** Messages still record; the Student just stops producing knowledge-grounded replies — Co-Pilot drafts nothing, while Auto-Pilot **fails open** to its fallback ack.
6. **Compliance is re-checked at the moment of sending**, not just when drafting.
7. **One conversation = one AI state**, and a human can take over at any moment without being overwritten by a slow background AI write.
8. **Respect every opt-out.** Never message an opted-out contact.

---

## 15. How to update this document (revision control)

This document is version-controlled by **two things working together**: the revision table below, and the project's git history. Follow this whenever you change anything here.

1. **Make your edit** to the relevant section(s).
2. **Bump the version number** in the [Document control](#document-control-at-a-glance) box and in the [Revision history](#16-revision-history) table, using semantic-style versioning:
   - **Major (vX.0)** — a structural change, a new procedure, or a behavior change that changes what staff must *do*.
   - **Minor (v1.X)** — clarifications, wording, small corrections, added tips.
3. **Add a new row** to the Revision history table: version, date (`YYYY-MM-DD`), author, and a one-line summary of what changed.
4. **Update "Last updated"** in the Document control box to today's date.
5. **Keep companion docs in sync.** If the change also affects concepts, update `John/LLM Training Manual.md`; if it affects architecture, that lives in `replit.md`. Don't duplicate detail — link to it.
6. **Save / commit.** The platform checkpoints the repo automatically, so git history is your durable audit trail; the table is the human-readable summary on top of it.

> **Rule of thumb:** if a staff member would *do something differently* because of your edit, it's at least a minor bump and needs a revision-history row. Typo fixes don't need a row but are welcome.

---

## 16. Revision history

| Version | Date | Author | Summary of change |
|---|---|---|---|
| **v1.0** | 2026-06-23 | Platform team | Initial release. Full granular how-to: access/roles, knowledge loading, Professor sessions, fact acceptance & Classroom push, conflict resolution, engagement modes, inbox operation, colors/states, handback handling, self-learning loop, opt-outs, troubleshooting, safety rules, and this revision-control policy. |
| **v2.0** | 2026-06-26 | Platform team | Added the Co-Pilot **Brand-Scope triage Router** and **fallback holding phrase** (new §7a; plus inbox §8, colors §9, and troubleshooting §13 updates) and the Conductor **Brain knowledge-pull** procedure (new §5a). 60-second mental model (§2) and knowledge-loading (§3) updated to match. |
| **v3.0** | 2026-06-27 | Platform team | **Removed the live Professor escalation / self-learning loop.** Professor is now **creation-only**; **no engagement mode learns at runtime**. Rewrote Auto-Pilot to the **fail-OPEN** turn responder + **circuit breaker** (§2, §7, §8, §11) and dropped the category auto-send block — **compliance/opt-out is the only hard send-time guard** (§4, §8, §14). Reframed conflicts (§6), the fallback phrase (§7a), colors/handbacks (§9–§10), troubleshooting (§13), and the §11 learning section ("Why no conversation learns at runtime"). |

---

*End of guide. Keep this document current — update the section **and** the revision history together (see §15).*
