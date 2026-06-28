# Migration How-To — TextLine → Textitie (Staff Training Manual)

_Product: **Textitie** (internal codename **SAMA**)_
_Feature: **TextLine Migration Assembly Line** (a.k.a. "TextLine Smasher")_
_Audience: Conductor operators / onboarding staff_
_Last updated: June 28, 2026_

---

## 0. What this is, in one paragraph

The Migration Assembly Line imports a customer's existing **TextLine** history —
their agents, departments/groups, address book (customers), conversations, and the
individual messages inside those conversations — into Textitie. It does this in a
**safe, two-gate** way: nothing the tool imports is ever visible to the tenant's
agents until **you** explicitly approve it twice. First you review a read-only
**summary** and approve the data into a hidden ("quarantined") staging state; then
you **flip it live** to reveal it in the inbox. At every step you can walk away,
come back, or throw the whole thing out without ever touching the tenant's live data.

> **Golden rule:** importing is reversible right up until **Flip live**. Flipping
> live and discarding are the only two actions that cannot be undone.

---

## 1. Before you start (prerequisites)

You need **all** of the following:

1. **Conductor access.** The migration lives in the **SAMA Control Plane** (the
   admin app, served at `/admin/`). You sign in with the Conductor (operator)
   credentials. If you can see the tenant list, you have access.
2. **The tenant already exists in Textitie.** Migration imports *into* an existing
   tenant. If the customer hasn't been created yet, create the tenant first
   (Onboarding), then come back here.
3. **The tenant's TextLine API access token.** This is the single credential the
   tool needs. The customer (or you, with their permission) generates it from inside
   their TextLine account. It is a secret — treat it like a password.
   - You paste it **once** to start the job. The system **encrypts it at rest** and
     **never logs it**. You do not need to store it anywhere yourself.

You do **not** need: a base URL, a separate password, database access, or anything
from engineering. One token is the whole entry ticket.

---

## 2. Where the migration lives (navigation)

1. Open the **SAMA Control Plane** (admin app).
2. Go to the **Tenants** list and click the tenant you're migrating. This opens the
   **Tenant Detail** page.
3. Click the **Migrations** tab.
   - The tab is bookmarkable: the URL ends in `?tab=migrations`. You can send a
     teammate a direct link to a tenant's Migrations tab and it will open straight to
     it.

You are now on the **Migrations panel**. Everything below happens here.

---

## 3. The big picture — the job lifecycle

A migration is a **job** that moves through a fixed set of states. You don't set
these by hand; background workers advance the job, and you act at the **two human
gates** (shown in **bold**).

```
pending → extracting → extracted → verifying → REVIEW (gate 1: you approve hydrate)
        → hydrating → complete → AWAITING GO-LIVE (gate 2: you flip live) → live
```

Plus two off-ramps you can reach from most states:

```
…any state… → failed        (an error stopped it; you can discard & retry)
review/complete → discarded  (you threw it out; staged data deleted)
```

| State | What's happening | What YOU do |
| --- | --- | --- |
| `pending` | Job created, waiting for a worker to pick it up | Nothing — wait |
| `extracting` | Pulling raw data from TextLine into staging | Nothing — watch progress |
| `extracted` | All raw data pulled | Nothing — it auto-advances |
| `verifying` | Counting everything & finding anomalies (no live writes) | Nothing — wait |
| `review` | **Gate 1.** Verified. Summary is ready. | **Review the summary, then Hydrate** |
| `hydrating` | Writing imported rows into hidden (quarantined) tables | Nothing — wait (resumes if interrupted) |
| `complete` | Hydration done; data staged but hidden | (moves to the "Awaiting go-live" list) |
| awaiting go-live | **Gate 2.** Quarantined, not yet visible | **Flip live** (or Discard) |
| `failed` | An error stopped the job | Read the error; Discard & restart |
| `discarded` | You threw it out; staged rows deleted | Nothing — it's gone |

> **Note on the word "verified":** the panel shows an alert titled **"Verified —
> ready to review"** when the job reaches the `review` state. "Verified" here just
> means *"we counted everything and wrote nothing live yet."* It is the same moment
> as the `review` gate.

---

## 4. Step-by-step: running a migration

### Step 1 — Start the migration

On the Migrations panel:

1. Find the start card at the top. It explains that imported data stays
   **quarantined** until you flip it live.
2. In the field labeled **"TextLine API access token"**, paste the tenant's token.
   (The field is masked, like a password box.)
3. Click **Start Migration**.
   - The button is disabled until you've typed a token, and shows **"Starting…"**
     while it submits.

What happens: a new job is created in `pending` and a background worker picks it up
within seconds. The token is encrypted and stored against this job.

> **One at a time.** Only **one** migration can run per tenant at once. If a job is
> already active, you'll see **"A migration is already in progress"** instead of the
> token field. Wait for the current one to finish, flip, or be discarded.

### Step 2 — Watch the extraction

Under **"Active migration"** you'll see a live progress card that refreshes by
itself every few seconds. On it:

- A **status badge** (e.g. `extracting`, `verifying`) and a spinner while active.
- **"extracting `<entity>`"** tells you which kind of data is being pulled right now
  (e.g. `conversations`, `conversation_posts`).
- A **counts grid** — running totals per entity (agents, customers, conversations,
  messages/posts…) as they're staged.
- **page cursor** — how far through the current entity's pages the worker is. This is
  the resume point; it's normal for it to climb and reset between entities.
- **consecutive failures** — only appears if the worker has hit transient errors
  (see §6). Zero is normal.
- **updated** — timestamp of the last progress tick.

You do **not** need to babysit this. Large accounts can take a while. You can leave
the page and come back; the job keeps running on the server.

### Step 3 — The Review gate (Gate 1)

When the job reaches **`review`**, you'll see the alert **"Verified — ready to
review"** and a **summary** appears. **This is the most important screen in the whole
process — read it before doing anything.** Nothing has been written to the tenant's
live data yet.

The summary is a grid of tallies. Here's what each number means and what to watch
for:

| Summary field | Meaning | When to be concerned |
| --- | --- | --- |
| **conversations** | Conversation threads that will be imported | Should be in the ballpark of what the customer expects |
| **flagged** | Conversations with something odd about them | A few is normal; a huge number warrants a look at the anomalies list |
| **messages** | Individual messages that will be imported | Should dwarf the conversation count |
| **skipped MMS** | Picture/media messages not imported (text is migrated, not media) | Expected; just confirm the customer knows media isn't carried over |
| **unique phones** | Distinct phone numbers found across everything | Sanity check against the customer's customer-base size |
| **alias collapsed** | Multiple TextLine identities folded into one contact | Informational |
| **missing phone** | Records that had no usable phone number | These can't become contacts (phone is required); high numbers mean messy source data |
| **merged into live** | Imported contacts that match a phone **already** in the tenant's live contacts — these will be merged, not duplicated | Expected on tenants that already have contacts |
| **address book** | Contacts coming from the TextLine **address book** (the "customers" list) | — |
| **standalone** | Address-book contacts with **no conversation history** (a name/number with no chats) | This is the key "address book extraction" number — confirms saved contacts come across, not just people who've texted |
| **address book no phone** | Address-book entries with no phone | Can't be imported as contacts |
| **address book dupes** | Address-book entries that duplicate one another | De-duplicated automatically |

Below the tallies is an **Anomalies** list (capped at 25 shown, with a "…and N
more" line). Each anomaly shows a **type**, an optional **reference** (an ID, never a
message body — no private content is shown), and a short **detail**. Skim these to
understand the "flagged" / "missing phone" numbers. Anomalies do **not** block the
import; they're a heads-up about messy source data.

**Decision point:**
- Numbers look right → continue to Step 4 (**Hydrate**).
- Numbers look very wrong (e.g. zero conversations for an active account, or wildly
  off counts) → **Discard** (§5) and investigate the token / TextLine account before
  retrying. Don't hydrate data you don't trust.

### Step 4 — Hydrate into quarantine

When you're satisfied with the summary, click **"Hydrate into quarantine"** (shows
**"Hydrating…"** while it runs).

What this does: it promotes the staged data into the **real** contacts /
conversations / messages tables, but every imported row is marked **quarantined**,
so it stays **hidden from the tenant's inbox**. The job moves to `hydrating`, then
`complete`.

- This step is **resumable**: if it's interrupted, clicking Hydrate again continues
  from where it left off — it won't double-import.
- Still **nothing is visible** to the tenant. You have one more gate.

### Step 5 — The Go-Live gate (Gate 2): Flip live

Once hydration finishes, the job appears under **"Awaiting go-live"** with the alert
**"Hydrated & quarantined"**. Review the summary one last time, then:

1. Click **"Flip live"** (shows **"Flipping…"** while it runs).
2. A confirmation dialog — **"Flip this migration live?"** — explains the
   consequences. Read it.
3. Confirm with **Flip live**.

What this does: it clears the quarantine flag so **every imported conversation,
message, and contact appears in the tenant's live inbox**. During the flip:

- **Auto-merge:** if an imported contact's phone number already matches a contact
  that's live in the tenant, the imported conversations are **re-pointed to the
  existing live contact** and the duplicate is removed — no double contacts.
- **Safety block:** if a phone number can't be safely merged, the flip is **blocked**
  so you can resolve it first, rather than creating a mess.

> **This cannot be undone.** Flipping live is the finish line. After this, the data
> is the tenant's live history.

---

## 5. Discarding a migration (the clean undo)

Any time **before** flip-live — including a `failed` job or a `review`/`complete`
job you've decided against — you can throw the whole import away:

1. Click **"Discard"** (outline button; shows **"Discarding…"**).
2. Confirm in the **"Discard this migration?"** dialog with **Discard migration**.

What this does: permanently deletes **every quarantined imported row and all staged
data** for that job. **Live data is never touched.** This is the safe reset button —
use it freely when a token was wrong, the summary looked off, or a job failed.

> Discard **cannot** be undone, but it only ever deletes *imported/staged* rows, so
> it's safe: the worst case is you re-run the migration from scratch.

---

## 6. Troubleshooting

### "Rate limited — backing off"
TextLine throttled our requests (too many, too fast). The worker **automatically**
pauses and resumes after the time shown. **No action needed** — just wait. This is
normal on large accounts.

### "Migration failed"
The job hit an error it couldn't recover from. The card shows a red **"Migration
failed"** alert with the error text, and **consecutive failures** will be non-zero
(the system retries a handful of times before giving up).
1. Read the error message.
2. If it's about the **token** (auth/permission), the token is wrong, expired, or
   lacks access — get a fresh one.
3. **Discard** the failed job, then **Start Migration** again with a good token.

### A job seems stuck
Workers lease jobs and heartbeat. If a worker crashes mid-run, the lease expires and
another worker automatically reclaims and resumes the job — there's nothing for you
to click. Give it a minute. If it truly never moves and isn't rate-limited, discard
and restart, and flag it to engineering.

### "A migration is already in progress"
Only one active migration per tenant. Either let the current one finish/flip, or
discard it, before starting another.

### Some entity shows zero (e.g. no agents or no address book)
Agents, groups, and the address book are **optional** — if the TextLine account
doesn't expose them, the tool **skips them and keeps going** rather than failing.
Zero there isn't necessarily an error; confirm against what the customer actually has
in TextLine.

---

## 7. What gets migrated (and the order)

The tool imports in a deliberate order so relationships line up:

1. **Agents** — the customer's TextLine users/agents. Used to correctly attribute who
   sent each outbound message.
2. **Departments / Groups** — used for routing/assignment context.
3. **Customers (address book)** — the saved contact list. This is what produces the
   **standalone** contacts: people saved in the address book even if they never
   texted. (Tags on those contacts come across too, merged non-destructively.)
4. **Conversations** — the chat threads (metadata).
5. **Conversation posts (messages)** — the actual message text inside each thread.
   (Text is migrated; **MMS/media is skipped** — see "skipped MMS" in the summary.)

Everything imported is **quarantined** until you flip live.

---

## 8. Quick reference — buttons & states

**Buttons you'll click:**
- **Start Migration** — begins a job from a pasted TextLine token.
- **Hydrate into quarantine** — Gate 1: approve verified data into hidden tables.
- **Flip live** — Gate 2: reveal imported data in the tenant's inbox (irreversible).
- **Discard** → **Discard migration** — delete an import; live data untouched.

**Panel sections:**
- **Active migration** — the job currently running.
- **Awaiting go-live** — hydrated jobs waiting for your Flip live.
- **History** — finished (flipped) and discarded jobs.

**The two irreversible actions:** **Flip live** and **Discard**. Everything else is
safe and resumable.

---

## 9. The 60-second checklist

1. ☐ Tenant exists in Textitie.
2. ☐ You have the tenant's TextLine API access token.
3. ☐ Tenant → **Migrations** tab.
4. ☐ Paste token → **Start Migration**.
5. ☐ Watch extraction (counts climb; leave & return is fine).
6. ☐ At **review**: read the **summary** — do the numbers make sense?
7. ☐ Numbers good → **Hydrate into quarantine**. Numbers bad → **Discard** & fix.
8. ☐ At **Awaiting go-live**: review once more → **Flip live** → confirm.
9. ☐ Done — verify a few conversations appear correctly in the tenant's inbox.

---

_Questions or a job that's genuinely stuck (not rate-limited, not advancing for a
long time)? Capture the **job #** shown on the card and the error text, then escalate
to engineering._
