# Phase 7.1 — Advanced Features (First Pass)

> Scope confirmed with user: items **1–5** of the original Phase 8 list.
> MMS, Surveys (CSAT/NPS), and Group messaging deferred to a later session.

---

## In scope this session

| # | Feature | Status |
|---|---------|--------|
| 1 | Whispers (internal notes on conversations) | Planned |
| 2 | Dispositions / resolution categories | Planned |
| 3 | Contact management & tagging | Planned |
| 4 | Conversation search & filtering | Planned |
| 5 | Reminders on individual conversations | Planned |

## Deferred to next session

| # | Feature | Reason |
|---|---------|--------|
| 6 | Surveys (CSAT, NPS) | Needs public response page + score aggregation; warrants own session |
| 7 | MMS support | Needs object storage + Twilio media URL handling; user did not pick stub vs real |
| 8 | Group messaging | Largest data-model change (multi-recipient threads); own session |

---

## Design — Item 1: Whispers (internal notes)

**Goal:** agents can post a note inside a conversation that is visible to other agents but NEVER sent to the contact.

**Schema:** no new table. Extend `messages.direction` (already `text`, not enum) to allow value `'internal'` in addition to `'inbound'`/`'outbound'`. The Twilio sender already only sends rows it creates with `direction='outbound'`, so internal rows are inert by construction.

**API:**
- `POST /api/conversations/:id/whisper` body `{ body: string }` — creates a `messages` row with `direction='internal'`, `senderName=<current agent>`. Tenant-scoped via `requireTenantAuth`.
- Existing `GET /api/conversations/:id/messages` returns whispers inline; client distinguishes by `direction`.

**UI:** toggle in the composer (`Reply` / `Whisper`). Whisper messages render with yellow background + lock icon. Twilio webhook flow is untouched.

---

## Design — Item 2: Dispositions

**Goal:** when an agent closes a conversation, they pick a category (e.g. "Sale", "Support resolved", "Spam") and optionally a freeform note.

**Schema:**
- New table `dispositions(id, tenant_id, label, color, sort_order, archived, created_at)`.
- Add columns to `conversations`: `disposition_id` (FK, nullable, on-delete set null), `resolution_note` (text, nullable).

**API:**
- CRUD: `/api/dispositions` (GET list, POST create, PATCH :id, DELETE :id → soft-archive).
- Extend the existing close flow (PATCH `/api/conversations/:id` setting `status='closed'`) to accept optional `dispositionId` + `resolutionNote`.

**UI:**
- Settings → Dispositions page (label/color editor).
- "Close conversation" modal in the inbox now shows disposition picker + note field.
- Resolved conversations show a colored disposition pill in the header.
- Analytics dashboard gets a "By disposition" breakdown later (out of scope unless time permits).

---

## Design — Item 3: Contact management & tagging

**Goal:** promote contacts from "a string in `conversations.contact_phone`" to first-class records with tags + notes + history.

**Schema:**
- New table `contacts(id, tenant_id, phone, name, email, notes, tags text[], first_seen_at, last_interaction_at, created_at, updated_at)`. Unique on `(tenant_id, phone)`.
- Add `contact_id` (FK nullable) to `conversations`. Backfill from existing `contact_phone` on first deploy via a one-shot upsert at boot.
- Webhook handler upserts contact row on inbound, links new conversations to it.

**API:**
- CRUD `/api/contacts` (list with `?q=&tag=` search/filter, pagination, GET :id with conversation history, POST, PATCH, DELETE).
- `GET /api/contacts/tags` — distinct tag list for the autocomplete.

**UI:**
- New "Contacts" page in the sidebar nav (icon: `Users`).
- List view with search box, tag filter chips, name/phone/last-interaction columns.
- Detail drawer with editable name/email/notes/tags + conversation history.

---

## Design — Item 4: Conversation search & filtering

**Goal:** in the inbox, filter the conversation list by text search (contact name/phone/last message), status, tag (via contact), assigned agent, date range.

**Implementation:** extend `GET /api/conversations` query params:
- `q` — ILIKE across `contact_name`, `contact_phone`, and most-recent `messages.body`.
- `status` — `open` | `closed` | `all` (current default presumed `open`).
- `tag` — single tag, joined via the new `contacts.tags` array (`@>`).
- `assignedUserId` — int.
- `from`, `to` — ISO timestamps on `created_at`.

Indexes already in place from Phase 7 cover the date filter. We add a partial trigram index on `contacts.tags` only if profiling shows we need it (skip for now).

**UI:** search input + filter popover above the conversation list. Active filters render as removable pills. URL-synced via `wouter` query string so bookmarks work.

---

## Design — Item 5: Reminders

**Goal:** an agent attaches a reminder to a conversation ("ping me about this in 2h"). When `remind_at` passes, the reminder shows up in a top-bar bell with a count.

**Schema:**
- New table `reminders(id, tenant_id, conversation_id, user_id, remind_at, note, created_at, fired_at, dismissed_at)`.
- Indexes: `(tenant_id, user_id, fired_at)` for the "due for me" query, `(remind_at)` partial-where-`fired_at IS NULL` for the scheduler scan.

**API:**
- `POST /api/reminders` `{ conversationId, remindAt, note? }`.
- `GET /api/reminders?status=pending|due|all` — scoped to current tenant + user.
- `PATCH /api/reminders/:id/dismiss`.
- `DELETE /api/reminders/:id`.

**Scheduler hook:** the existing 60s timer engine (used by auto-resolve + scheduled campaigns) gets a new pass: `SELECT … WHERE fired_at IS NULL AND remind_at <= NOW()` → set `fired_at`. (No push notification — surfacing happens client-side via a 30s polling query.)

**UI:**
- "Remind me" button in the conversation header → modal with quick presets (1h / 4h / tomorrow 9am / custom).
- Top nav bell icon with red dot + count of due-and-not-dismissed reminders for the current user.
- Click bell → dropdown of due reminders, each links to the conversation; "Dismiss" button per row.

---

## Execution order

1. Schemas first (additive only — no breaking changes to existing tables besides new nullable columns) → `pnpm push` → typecheck.
2. OpenAPI additions → `codegen` (so client hooks are ready when UI is built).
3. Backend routes (whispers, dispositions, contacts, reminders, conversation search params, scheduler reminder pass).
4. Conductor auth whitelist updates for every new tenant route.
5. Frontend: composer whisper toggle, close-with-disposition modal, Contacts page, inbox search/filter, reminder bell + button.
6. End-to-end smoke test of each feature with curl + UI screenshot.
7. Code review pass (architect skill) → fix MUST-FIX only.
8. Update `replit.md`.

## Out of scope (explicit non-goals this session)

- No survey response collection, no NPS scoring, no MMS, no group threads.
- No analytics breakdowns by disposition / tag (Phase 7 analytics stays as-is).
- No push notifications for reminders — polling only.
- No bulk contact import (CSV upload) — single-record CRUD only this pass.
- No tag-based automations — tags are descriptive only this pass.
