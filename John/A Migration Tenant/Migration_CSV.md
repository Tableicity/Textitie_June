# Migration CSV — Quick Contact Import (Staff Training)

> Internal training doc. Explains **what** the CSV import is, **why** it lives where
> it does, and **how** it relates to the full TextLine Migration. This is the plan of
> record for the build — it does **not** modify the existing Migration feature.

---

## 1. The one-line idea

**A CSV import is a Migration with the hard part removed.** The full TextLine
Migration spends ~90% of its effort *safely crawling a rate-limited external API*
(access tokens, leases, retries, resumable pagination). A CSV has none of that —
the "extract" step is simply *parsing a file the operator hands it*. Everything
downstream is the same proven, safe assembly line.

So the CSV importer is **not a step-child or side glue** — it is a true sibling of
Migration, built to the same blueprint and living in the same place.

---

## 2. Why it lives in Admin, not the App

Guiding principle from the visionary: **no one dumps a phone-book-sized contact
list into the pristine end-user App.**

- The importer lives in the **Admin Control Plane** → **Tenant** → **Migration**
  tab, as its **own Card** next to the TextLine Migration.
- Only an **operator (Conductor)** runs it — never the tenant's agents.
- Imported records land in the real tables but **quarantined / hidden** until the
  operator reviews and flips them live. Nothing reaches the live App unreviewed.

This is exactly the safety model the TextLine Migration already uses; the CSV lane
reuses it rather than reinventing it.

---

## 3. The safety pipeline (same spine as Migration)

| Assembly-line phase | TextLine Migration | CSV Import (this build) |
| --- | --- | --- |
| **Extract** | Crawl the API, paged, leased, resumable | Parse the uploaded file (synchronous) |
| **Stage** | Raw JSON per page, stored faithfully | Raw rows staged the same way |
| **Verify** | Counts, duplicates, anomalies | Same: counts, bad phones, duplicates |
| **Review** (operator stop) | Yes | **Yes — same gate** |
| **Hydrate** (quarantined) | Contacts + conversations + messages | Contacts (v1); conversations/messages later |
| **Flip live / Discard** | Reveal / delete | Identical |

The operator sees a **review summary** (how many new, how many duplicates, how many
bad rows) *before* anything goes live, then clicks **Flip live** or **Discard**.

---

## 4. Architecture decision — Option 2 (parallel lane)

There were two ways to build this:

- **Option 1 — fold CSV into the existing Migration pipeline** as a new "source."
  Most unified, and the Migration schema was even built generic to allow it. **But**
  it means editing the live, concurrency-sensitive Migration workers and Admin panel.

- **Option 2 — a parallel CSV lane built to the same blueprint (CHOSEN).**
  Its own small job record and its own Card in the same Migration tab, but it
  **reuses the same safety spine**: the same quarantine columns already on the
  contacts/conversations/messages tables, the same review gate, and a *shared*
  flip-live helper (advisory lock, contact reconciliation, duplicate-collision
  proofing) refactored so the **TextLine path keeps calling it unchanged**.

**Why Option 2:** it delivers the feature quickly and safely, and — per the explicit
instruction — the existing **TextLine Migration build is never touched**. Later,
merging both into one unified pipeline (if ever desired) becomes a lift-and-merge,
not a rewrite, because they already share the same patterns.

---

## 5. Departments — bound to the phone number, not the contact

Decision: **contacts do NOT carry a department.** Departments attach to a
**phone number** (and therefore to the conversations that flow through it). When a
number is reassigned to a different department, all of its content **moves in
lockstep** automatically. This keeps the CSV simple (no per-contact department to
pick or maintain) and avoids adding friction to the import. Contact-department
linkage is intentionally **left as-is**.

---

## 6. Scope for v1 (this week's testing)

**In scope:** a contacts-only CSV — the operator uploads a file, reviews the
summary, and flips it live into the tenant's contact book.

- Typical columns: **phone (required)**, plus optional name, email, location,
  notes, tags.
- Every phone number is normalized to E.164 (the platform's mandatory format);
  rows with an unparseable phone are reported, not silently dropped.
- Duplicate phones are reconciled against existing live contacts (no duplicate
  records get created).

**Explicitly deferred to the richer build (see roadmap):** message history and
media.

---

## 7. Future roadmap (how the vision extends cleanly)

The same spine already supports where this is going:

- **Both sides of the thread (in & out):** the `messages` table already records
  message **direction** (inbound / outbound / internal) and carries the quarantine
  flags. A richer CSV that includes conversation history simply stages more entity
  types and writes quarantined messages — the exact shape TextLine already uses. No
  new concept needed.
- **Documents / photos:** honest gap — **nothing stores media today.** The inbound
  path keeps only a media *count* and discards the file URLs; there is no attachment
  table, and the outbound sender cannot send media yet. This is the same gap for
  TextLine and CSV alike, so it is a shared future workstream (an App Storage
  capability is available to build on). The CSV lane will be designed with an
  attachment *seam* so it is ready when that workstream lands.

---

## 8. What staff will actually do (operator workflow)

1. Open **Admin → Tenant → Migration** for the target tenant.
2. In the **CSV Import** card, upload the contact CSV.
3. Wait for the **review summary** (new vs. duplicate vs. rejected rows).
4. Click **Flip live** to reveal the contacts into the tenant's book, or
   **Discard** to throw the staged batch away.

Nothing the operator uploads is visible to the tenant's agents until step 4.
