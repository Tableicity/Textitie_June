---
name: Outbound From resolution & number↔tenant binding
description: How the outbound SMS "From" number is chosen and why a tenant must only send on a number it owns.
---

# Outbound "From" resolution

- The "From" number is resolved LIVE per send from the DB — it is NOT carried in the login JWT and is NOT cached on the user session. Numbers are per-TENANT (and per-department), never per-user.
- Resolution order on the agent-reply path: `department.phone_number` → `tenant.phone_number` → (historically) global `SAMA_FROM_NUMBER`.

## The split-conversation bug (root cause)

`SAMA_FROM_NUMBER` is itself a **real tenant's** number (it was set to john-reynolds's number). A numberless tenant (e.g. ACME) that sent outbound silently fell back to that global default. The outbound went out on john-reynolds's number, so the carrier routed every reply to the **owner** (john-reynolds). Result: one conversation split across two tenants — outbound rows under the borrower, inbound rows under the number's owner. The message was never lost, just filed in the wrong tenant's inbox. Inbound routing (by destination number → owning tenant) is correct and was never the problem.

## The guardrail (strict number↔tenant binding)

**Rule:** a tenant-scoped send (`tenantId != null`) may only send on a number the tenant OWNS. If it has none, or the supplied number belongs to another tenant, REFUSE — do not borrow the global default. Platform-level sends (`tenantId == null`, deliberate conductor ops) may still use the configured default.

**Why a presence check is not enough:** checking only that `fromOverride` is non-empty stops the numberless-fallback case but still lets a buggy/future caller pass another tenant's number. The authoritative check verifies ownership against `tenants.phone_number` OR `departments.phone_number WHERE tenant_id = :tenantId`.

**How to apply:** the sender (`lib/senders/twilio.ts send()`) is the single choke point every live outbound path funnels through (agent reply, campaigns, surveys, injection/sama) — put the authoritative async ownership check there (`verifyOutboundFromOwnership` in `lib/outboundFrom.ts`). Resolution sites that already pick the number from the tenant's own rows can use the cheap sync presence guard for a clean user-facing 422. The **stub sender is intentionally NOT guarded** (dev/seed safety). automationEngine auto-replies are DB-insert only (never call the sender), so they are out of scope.

## Other durable telephony facts

- Before this guardrail, sending on a number the tenant did not actually own at the carrier produced **Twilio error 21660** ("From phone number not in your account").
- The tenant's number **doubles as the inbound routing key**: inbound is matched by destination number → owning tenant, so there is effectively **one two-way tenant per number**. This is exactly why borrowing another tenant's number splits the conversation.
- The 10DLC compliance badge in the UI is **cosmetic** — it is a status display, NOT a gate that blocks sending.
