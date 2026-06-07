---
name: Telephony From resolution & number assignment
description: How a tenant's send/receive number works, the 21660 trap, and why the 10DLC badge is not a gate
---

Outbound `From` = `tenant.phoneNumber ?? SAMA_FROM_NUMBER` (see `lib/sama.ts` `fromOverride` → `senders/twilio.ts`). A tenant with no number falls back to the global `SAMA_FROM_NUMBER`.

**The 21660 trap:** if a tenant's `phoneNumber` is a number the connected Twilio account does NOT own, every send fails with `Twilio 21660: Mismatch between the 'From' number ... and the account`. This is the #1 recurring telephony bug (ACME was stuck on a stale `+19094904265` from an old account). Assignment is now a validated picker (`GET /api/tenants/owned-numbers` → Tenant Detail Telephony card) listing only owned numbers, so this can't recur through the admin UI.

**Single-number inbound constraint:** `tenant.phoneNumber` is ALSO the inbound routing key (`resolveTenantByPhoneNumber`). So a given number can be fully two-way for only ONE tenant. On a single-number account, one tenant owns the number; others are best left **unassigned** (outbound-only via the fallback).

**The compliance "10DLC Required" badge is NOT a send gate.** It was pure `region === "US"` cosmetics; the send path never checks it. A tenant showing "Required" still sends fine (proven by john-reynolds on the TFN). Also: Toll-Free numbers (`+1 800/833/844/855/866/877/888…`) use **Toll-Free Verification**, not 10DLC — the badge now classifies by number type, not region.

**Why:** John repeatedly reports "tenant X still sends from the old number" / worries compliance status blocks sending. Root cause is almost always the From-resolution data (wrong/stale `tenant.phoneNumber`), never the badge.
