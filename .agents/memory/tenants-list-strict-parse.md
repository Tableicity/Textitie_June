---
name: Tenants list strict parse
description: Why one bad tenant row can 500 the whole list endpoint
---

`GET /api/tenants` parses the **entire result array** through a strict Zod schema, so a **single** row with an enum-invalid field (e.g. `region` not in `DE`/`EE`/`US`) makes the whole endpoint 500 — not just that row.

`tenants.region` is a plain `text` column with **no DB CHECK constraint**, so invalid values can be introduced out-of-band (manual SQL, or a code path that bypasses the API-Zod body validation by inserting directly).

**Why:** Self-signup used to insert `region:"us"` (lowercase) directly into `tenantsTable`, bypassing the `CreateTenantBody` enum; every self-signed-up tenant silently 500'd the conductor's tenant list. Fixed the insert to `"US"` and normalized existing rows.

**How to apply:**
- When a list endpoint 500s but single-record GETs work, suspect one enum-/shape-invalid row failing a whole-array parse.
- Recommended hardening (not yet done): add `CHECK (region IN ('DE','EE','US'))` so bad rows can't be written at all.
