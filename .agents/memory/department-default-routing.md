---
name: Department default routing & null-dept invariant
description: Why every new conversation must get a department, and why off-webhook conversation phones must be E.164.
---

# Department default routing & the null-department invariant

The agent inbox department filter no longer offers an "All Departments" or
"Unassigned" bucket (the user judged those the root cause of conversations
getting lost).

**Invariant:** a conversation with `department_id = null` is INVISIBLE in the
inbox for any tenant that has at least one department. So every NEW conversation
must be assigned a real department, or it disappears. This applies to ALL
creation paths — the inbound Twilio webhook (which previously created null-dept
conversations), the signup seed, and the New Message dialog.

**Why:** removing the filter buckets without routing inbound would have hidden
every incoming customer text — a severe regression.

**How inbound resolves a department** (`resolveInboundDepartmentId` in
`tenantPhoneLookup.ts`): the department that OWNS the inbound `To` number in the
canonical `phone_numbers` table (a `kind='department'` row), else the tenant's
oldest department (= the signup-seeded "Demo Department" for new tenants), else
null. The phone_numbers lookup is tenant-scoped for defense in depth even though
the PK is the number.

**Signup seeds a default department:** every new tenant gets a "Demo Department"
plus the owner as the first contact + a welcome conversation, so the inbox is
never empty out of the gate.

**E.164 gotcha (would cause a duplicate-conversation bug):** the inbound webhook
keys its "find existing OPEN conversation" lookup on the E.164 `From` number, and
`contacts.phone` / `conversations.contactPhone` are stored E.164 everywhere on
the live path (Twilio's `From` is E.164). Any conversation/contact created
OUTSIDE the webhook (e.g. the signup seed) MUST canonicalize the phone with
`normalizePhoneE164` or a real text from that number spawns a DUPLICATE
conversation + a second contact row (contact unique index is `(tenant_id, phone)`).
`tenant_users.phone` keeps its raw-10-digit form (A2P opt-in evidence) — only the
contact/conversation phone needs E.164.

**Known tradeoff:** legacy null-dept conversations for tenants that already have
departments are now hidden (accepted by the user — they start fresh). Long-term,
an explicit per-tenant default-department setting would beat "oldest department"
for live tenants whose primary-number traffic should not pile into Demo.
