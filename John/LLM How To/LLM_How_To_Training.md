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
| **Current version** | **v1.0** |
| **Last updated** | 2026-06-23 |
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
6. [How to resolve a knowledge conflict](#6-how-to-resolve-a-knowledge-conflict)
7. [How to set the engagement mode (tenant default + per-conversation)](#7-how-to-set-the-engagement-mode-tenant-default--per-conversation)
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

## 8. How to work the inbox (Co-Pilot, Auto-Pilot, stepping in)

**Working a Co-Pilot (🟡) conversation:**
1. A customer texts in; the Student writes a draft and **pre-fills your composer.**
2. Read the draft. Edit anything you want.
3. Press **Send.** (Co-Pilot **never** learns — your edits and sends are never stored as truth.)
4. *Streaming drafts:* when the Professor is rescuing an ungrounded question, the customer reply **streams into your composer as it's written** — you can start editing before it finishes.

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

**What it is:** When a customer asks something the Classroom doesn't cover, the Student can't ground its answer (`kbMatched = false`). Instead of guessing, the system escalates to the **Professor** in the background, off the customer-reply path.

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

---

*End of guide. Keep this document current — update the section **and** the revision history together (see §15).*
