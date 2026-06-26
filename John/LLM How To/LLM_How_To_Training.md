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
| **Current version** | **v2.0** |
| **Last updated** | 2026-06-26 |
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
10. [How to handle every handback reason](#10-how-to-handle-every-handback-reason)
11. [How the self-learning loop works (and how to verify it learned)](#11-how-the-self-learning-loop-works-and-how-to-verify-it-learned)
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

- Every business (**tenant**) gets two AI workers: a fast **Student** that answers everyday texts from *approved* knowledge, and a slow, smart **Professor** that curates knowledge and rescues the Student when a customer asks something new.
- Knowledge flows through five stages: **Knowledge Base → Library → Professor → Classroom → Student.** Only the **Classroom** (approved, published facts) is what the Student is allowed to use with customers.
- Each conversation runs in one of three **engagement modes**: **Manual** (AI off), **Co-Pilot** (AI drafts, human sends), **Auto-Pilot** (AI may send by itself *if* every safety gate passes).
- In **Co-Pilot**, two optional Conductor settings shape the draft (both only ever *draft*, never send/learn): a **Brand Scope** (off-topic questions get a polite decline, general questions get a quick general answer) and a **Fallback Phrase** (a holding reply drafted when a tenant-specific question can't be grounded). See §7a.
- Besides Professor sessions, a Conductor can also **pull knowledge from the external Brain service** — same review-and-push, same Classroom (§5a).
- A human can take over **any** conversation at **any** time.
- The system only **learns** a new fact when the AI sent a reply **autonomously and unedited** (a clean Auto-Pilot send). Any human touch = no learning.

If you remember nothing else: **the Student only knows what's been pushed to the Classroom, and the AI never sends pricing, compliance, or technical-setup answers by itself.**

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

   | Category | Examples | Can the AI auto-send it? |
   |---|---|---|
   | `general` | Hours, location, general info | ✅ Yes |
   | `features` | What the product does | ✅ Yes |
   | `pricing` | Prices, discounts, billing | ❌ Never — human send only |
   | `compliance` | Legal, TCPA, consent, refunds | ❌ Never — human send only |
   | `technical_setup` | Install/config steps that can break things | ❌ Never — human send only |

7. Proceed to §5 to accept/reject these drafts.

> **Why the three "risky" categories exist:** money, law, and breakage. A wrong pricing/compliance/setup answer is costly or dangerous, so the AI is **never** allowed to send those on its own — it drafts them and a human sends.

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

**Checkpoint — did it actually take effect?** Ask the Student-facing path a test question (or watch a real inbound). If the Student still says "no matching knowledge," the fact is probably still in `draft` or was never pushed — repeat steps 2–3.

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
   - Fix the **category** if it is wrong (the category drives the safety gates — see §4).
   - Leave flagged/contradictory candidates unchecked unless you have verified them.
4. Select the candidates you want and press **Push.** This:
   - Validates every selected item is a real Brain candidate **for this tenant** — it refuses the **whole** push if any isn't (no partial promote).
   - Promotes them to **`published`** and snapshots a **new Classroom version** — always a full union of *every* published fact (Professor **and** Brain), so a Brain push never wipes Professor facts, and vice-versa.
5. Verify exactly as you would after a Professor push (§5): the facts show **`published`**, and the Student can now ground that topic.

> **⚠️ Safety:** Brain content is *candidate* knowledge, not auto-truth. A human (you) still accepts each fact and owns the truth decision — especially for `pricing` / `compliance` / `technical_setup`.

---

## 6. How to resolve a knowledge conflict

**Goal:** Clear a `conflict` flag so the AI stops going quiet on that topic.

**Why conflicts happen:** When two published facts mention the **same subject** but **different numbers** (e.g., "Pro plan is $50" vs "$60"), the Librarian flags both as `conflict`. While a conflict exists, the AI **refuses to auto-send** on that topic — on purpose.

1. In the Professor / Classroom view, find facts marked **`conflict`**.
2. Identify the correct statement (check the source material).
3. **Reject** the wrong fact and **keep** the correct one — or edit/re-absorb a single correct fact (§4–§5).
4. **Push to Classroom** again to publish the resolution.
5. Confirm the `conflict` flag is gone. Auto-send for that topic re-enables automatically.

> **Tip:** A sudden burst of "Conflicting knowledge" handbacks usually means a recent push introduced a contradicting price or policy. Resolve at the source rather than just rejecting one side blindly.

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
| **Auto-Pilot** | 🟢 Green | Yes | Yes, **if the gate passes** | Yes, **only on a clean autonomous send** | High-volume, well-covered topics |

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
3. What it does: in Co-Pilot, when an inbound reaches the grounded pipeline but has **no Classroom/KB match** (typically a question that needs this business's specific facts), Co-Pilot drafts this phrase **verbatim** (instead of guessing) and **skips** the slow Professor rescue. A human sends the stall, then teaches the real answer (§4–§5) so it's grounded next time.

> **⚠️ Safety:** The fallback is a *stall, not an answer.* It exists so the AI never guesses at brand-specific pricing/policy/account facts. Leaving it blank simply restores the default (Co-Pilot escalates ungrounded questions to the Professor for a drafted suggestion).

---

## 8. How to work the inbox (Co-Pilot, Auto-Pilot, stepping in)

**Working a Co-Pilot (🟡) conversation:**
1. A customer texts in; the Student writes a draft and **pre-fills your composer.**
2. Read the draft. Edit anything you want.
3. Press **Send.** (Co-Pilot **never** learns — your edits and sends are never stored as truth.)
4. *Streaming drafts:* when the Professor is rescuing an ungrounded question, the customer reply **streams into your composer as it's written** — you can start editing before it finishes.

> **Heads-up — a Co-Pilot draft can come from different places.** Besides the Student's normal grounded draft, in Co-Pilot you may see: a **polite decline** (the Brand-Scope Router judged the message off-scope), a **quick general answer** (in-domain but answerable from general knowledge), or your tenant's **fallback holding phrase** (a tenant-specific question that couldn't be grounded). All of them are just drafts — review, edit, and send as normal; none ever sends itself or learns. See §7a to tune these.

**Monitoring an Auto-Pilot (🟢) conversation:**
1. If the gate passes, the AI **sends the reply verbatim** and you'll see status `auto_sent`. No action needed — just monitor.
2. If the gate refuses or Grok fails, the conversation **hands back Blue for that one message** (status `refused` / `failed`) with a reason chip. Handle it manually (§10). After you do, the conversation returns to green for the next turn.

**Stepping into any conversation (works in any mode):**
1. Open the conversation and just send a message yourself.
2. The pending AI turn is marked **`human_handled`** and **is not learned.**
3. You have the wheel; the background AI will not overwrite what you sent.

> **⚠️ Safety:** Pricing, compliance, and technical-setup questions will **always** be handed to you in Auto-Pilot — the AI drafts but never sends them. This is correct, not a bug.

---

## 9. How to read inbox colors & AI-state chips

**Colors (effective engagement mode):**
- 🔵 **Blue** — AI off for this turn (Manual, or a handback for one message).
- 🟡 **Yellow** — Co-Pilot: a draft is ready for you to send.
- 🟢 **Green** — Auto-Pilot: the AI may send by itself when safe.

**AI-state status → what to do:**

| Status | Meaning | Your action |
|---|---|---|
| `idle` | Nothing pending | Normal |
| `drafted` | A draft is waiting (Co-Pilot or handback) | Review, edit, send |
| `auto_sent` | Auto-Pilot sent it verbatim | Nothing — monitor |
| `refused` | The gate declined to auto-send | Read the chip, send manually |
| `failed` | Grok or the send failed | Read the chip, send manually |
| `human_handled` | A human took this turn | Done — returns to green next turn |
| `superseded` | A newer inbound replaced this | Ignore (historical) |

> **Note:** In Co-Pilot, a `drafted` suggestion may be the Student's grounded draft, a Professor rescue, a Brand-Scope Router decline/flash answer, or the fallback holding phrase (§7a). They all behave identically — review, edit, send.

---

## 10. How to handle every handback reason

When the AI hands back Blue, a **chip** tells you why. The most important reason wins. Find the chip and do the matching action:

| Chip you see | What it means | What to do |
|---|---|---|
| "No matching knowledge" | The Classroom doesn't cover this | Answer manually; then teach it (§3–§5) so next time it's covered |
| "Sensitive topic — needs a human" | Pricing/compliance/setup intent | Answer manually — this will always need you |
| "Compliance hold — needs your review" | A compliance check blocked the send | Verify consent/opt-out status, then reply manually |
| "Conflicting knowledge — needs your review" | Two facts contradict | Resolve the conflict (§6), then reply |
| "Not confident enough to auto-send" | Confidence wasn't `high` | Read the draft, fix it, send |
| "Auto-send failed — please send manually" | The send attempt failed | Send manually; the system already freed the retry lock |
| "AI couldn't draft a reply" | The Student produced nothing usable | Reply manually |
| "AI is offline" | The AI key is unset/unavailable | Reply manually; tell a Conductor to check `GROK_KEYS` (§13) |

---

## 11. How the self-learning loop works (and how to verify it learned)

**What it is:** When a customer asks something the Classroom doesn't cover, the Student can't ground its answer — `kbMatched = false` **and** no strong Classroom search hit. Instead of guessing, the system escalates to the **Professor** in the background, off the customer-reply path. (A strong Classroom search hit suppresses escalation even when the Student self-reports no match, and the Professor must be configured.)

**What happens, in order:**
1. The inbound is written to a **durable staging queue** and a **per-conversation worker** processes one inbound at a time (rapid-fire texts are smartly **coalesced** into a single reply to the combined/latest message). This work **survives restarts**.
2. The **Professor** answers from the tenant's **Library** + its own expertise and returns: a customer reply, a confidence level, 2–3 candidate facts, and up to 3 follow-up questions.
3. **Injection safety:** the customer's text is treated as **a question only — never as truth.** Deterministic guards drop any "fact" that just echoes the customer or isn't actually supported by the Library. A customer can never *teach* the system.
4. **Learn-or-not:**
   - **Auto-Pilot + stricter gate passes** → send the reply, **then** persist the screened facts as published Classroom truth. The system won't escalate this question again.
   - **Co-Pilot** → the reply is drafted/whispered for you. **Nothing is learned.**
   - **Manual** → escalation is skipped.

**The one-line learning rule:**
> Facts are learned **if and only if** the reply was **sent autonomously AND unedited** (a clean Auto-Pilot send). Any human touch = no learning.

**How to verify it actually learned:**
1. After a clean Auto-Pilot send on a previously-unknown question, open the tenant's **Classroom**.
2. Confirm a **new published fact** appeared in the current version covering that topic.
3. Re-ask the same question — the Student should now ground it directly (no escalation).
4. If nothing was learned: the send wasn't clean/autonomous (a human touched it), the gate refused, or the candidate facts failed screening — all by design.

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

**"The AI isn't replying at all — every conversation is Blue / 'AI is offline'."**
→ A Conductor should check that the AI key (`GROK_KEYS`) is set. With no key, the AI safely stubs out by design and **SMS still works** — messages are still recorded.

**"The AI keeps handing back pricing/compliance questions."**
→ Correct behavior. Those categories **always** require a human send. The AI drafts them, you send them.

**"It says 'No matching knowledge' for something we definitely told it."**
→ The fact is probably still in `draft`, or it's in the Library but was never absorbed/pushed. Run a Professor session, accept the fact, and push to the Classroom (§4–§5).

**"It says 'Conflicting knowledge'."**
→ Two published facts contradict (often two prices). Resolve in the Classroom (§6); automation re-enables for that topic once resolved.

**"A customer got a duplicate text."**
→ The AI path is protected against this (one send per inbound). If it happened, check whether an automation rule **and** a campaign both fired, or whether a human also sent manually.

**"A Co-Pilot draft is a polite 'we can't help with that,' or a generic answer that ignores our specifics."**
→ That's the Brand-Scope triage Router (§7a): it judged the message off-scope (decline) or answerable from general knowledge (flash). It's Co-Pilot-only and never sends itself — edit/replace and send. If it misfires often, refine the tenant's **Brand Scope**.

**"Every ungrounded Co-Pilot reply is just our canned holding sentence."**
→ That's the **fallback phrase** (§7a) doing its job: the question was tenant-specific but nothing in the Classroom could ground it, so the system stalls instead of guessing. Send it, then teach the answer (§4–§5) so next time it grounds. To restore Professor-drafted suggestions for ungrounded questions, clear the tenant's **Fallback Phrase**.

**"We taught the Professor something but the Student still doesn't know it."**
→ The Student only reads the **published Classroom** — not Professor chat or the Library. Accept and **push** the facts to create a new Classroom version.

**"Why didn't it learn from that great Auto-Pilot conversation?"**
→ Learning happens only on a **clean, unedited, autonomous** send. If a human edited, stepped in, or it was Co-Pilot, nothing is learned — by design.

---

## 14. Hard safety rules (never break these)

1. **Customer text is a question, never truth.** Customers can never teach the system.
2. **Pricing / compliance / technical_setup are never auto-sent.** Drafted yes, AI-sent never.
3. **Gates are fail-closed.** When unsure, the system hands back to a human; it does not guess.
4. **Learning requires a clean autonomous send.** Any human touch ⇒ no learning.
5. **A missing AI key must never break SMS.** Messages still record; the AI just goes quiet.
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

---

*End of guide. Keep this document current — update the section **and** the revision history together (see §15).*
