---
name: Canonical phone-number routing (Guardrail B)
description: How inbound routing + outbound ownership are decided, why the single canonical table exists, and the rules for changing number ownership safely.
---

# Canonical phone-number routing

Phone-number ownership lives in ONE global table, `phone_numbers` (`phone_number` is the PRIMARY
KEY → platform-wide uniqueness; `tenant_id`, nullable `department_id`, `kind` 'primary'|'department').
Inbound routing (`tenantPhoneLookup`) and outbound ownership (`outboundFrom`) BOTH read only this
table and **fail closed**: an unknown number resolves to null and is never attributed to "the first
tenant".

The legacy `tenants.phone_number` / `departments.phone_number` columns still exist (UI / back-compat)
but are denormalized mirrors, kept in lockstep by the registry and verified by a boot-time drift
detector (`detectPhoneNumberDrift`, symmetric: denorm→canonical and canonical→denorm).

**Why:** a verified cross-tenant leak — +18887619212 routed to the wrong tenant because ownership
lived in two denormalized columns with NO uniqueness, and the resolver had a non-deterministic
primary match (no ORDER BY) plus an unscoped `departments` fallback that returned the first tenant
iterated. (John/architecture.doc.md Part 5.)

**How to apply:**
- NEVER write `tenants.phone_number` or `departments.phone_number` directly. The ONLY writer is
  `artifacts/api-server/src/lib/phoneNumberRegistry.ts` (`setTenantPrimaryNumber` /
  `setDepartmentNumber`): transactional, rejects cross-owner conflicts (409), race-guarded upserts
  (ON CONFLICT DO UPDATE ... WHERE existing owner matches, else 0 rows → throw), replace-old-in-
  same-txn, denorm kept in sync.
- NEVER reintroduce a resolver fallback. Unknown number → null is the correct, safe answer.
- DB hard guarantees: partial unique indexes enforce one primary per tenant
  (`WHERE kind='primary'`) and one row per department (`WHERE department_id IS NOT NULL`). Don't
  drop them — they make a concurrent steal a loud unique-violation, not silent corruption.
- Schema reaches prod via Replit's **Publish-time schema diff** (this is **managed Postgres** —
  `DATABASE_URL` is runtime-managed), NOT a deploy migration step. A workspace-shell `drizzle push`
  targets dev only; Publish introspects dev+prod and applies the diff to prod. The
  `ensurePhoneNumbersSchema()` boot DDL (`CREATE TABLE IF NOT EXISTS` + the two partial unique indexes)
  predates this understanding and is now **redundant belt-and-suspenders** (idempotent, harmless) —
  keep it in lockstep with lib/db/src/schema/phoneNumbers.ts but don't grow the pattern, and never
  write new prod migration scripts/deploy hooks. Never hand-run `push --force` against prod.
- If schema-per-tenant (Stage 4) is ever re-enabled, pin this module to the GLOBAL pool — phone
  routing is platform-global, not per-tenant.
