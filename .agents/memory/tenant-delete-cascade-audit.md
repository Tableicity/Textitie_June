---
name: Tenant-delete cascade audit ordering
description: Auditing FK cascades for a multi-table purge tx must follow the tx's delete ORDER, not just the tenant FK
---

When a destructive purge transaction (e.g. Conductor `DELETE /api/tenants/:id`)
deletes rows in a fixed order and relies on `ON DELETE CASCADE` for the rest,
auditing ONLY `tenants.id` FKs is not enough and will miss blockers.

**Rule:** audit every parent table the tx deletes, in delete-order. A child FK
to a NON-tenant parent that is deleted EARLY can block the first statement.

**Why:** the tx deletes `messages` FIRST (before `conversations`/`tenants`). A
child with an FK `-> messages.id` and no cascade (here
`conversation_inbound_ai_stages.inbound_message_id`) blocked the very first
`DELETE FROM messages`, so no conversation/tenant cascade ever got a chance to
fire. The intuition "messages are deleted first so they're safe" is backwards —
being deleted first makes their referrers the earliest blockers.

**How to apply:** for each statement in the tx (messages → reminders →
conversations → contacts → dispositions → departments → tenant_users → tenants),
grep every `references(() => <thatTable>.id` and confirm each referrer is either
cascade / set-null OR itself explicitly deleted earlier in the same tx. Covering
tables verified this way: messages.id (only `conversation_inbound_ai_stages`),
conversations.id (4 AI tables cascade; surveySends/campaigns set-null),
departments.id (phone_numbers cascade, conversations set-null), tenants.id
(cascade or explicit delete). A DB-backed regression that seeds one row per FK
path and calls the real route is the cheapest guard against re-introduction.
