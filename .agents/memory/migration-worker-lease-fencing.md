---
name: Migration worker lease fencing
description: Durable extraction worker (TextLine Smasher) — how to fence raw staging against reclaim/finalize without leaving a counts projection behind.
---

# Migration worker lease fencing (TextLine Smasher)

The durable extraction worker runs over many ticks with a lease (`lease_token` +
`leased_until`). A paused/stale worker that resumes after its lease expired and was
reclaimed must NOT corrupt state. Lessons that took ~4 architect rounds to converge:

**Rule: a leased worker's raw-staging INSERT must be BOTH lease-fenced AND row-locked
against the finalize that recomputes a projection.**

- `counts` is NOT tracked in memory — it is a SQL PROJECTION (`SUM(record_count)` per
  entity over `migration_raw_data`) recomputed INSIDE every fenced write
  (`saveExtractionProgress`, `markMigrationExtracted`). This is crash-safe and
  idempotent-insert-safe.
- **Why the projection alone is not enough:** if `stageRawData` is a plain insert (or
  even a non-locking lease check), under READ COMMITTED a stale worker can read its old
  lease snapshot and commit a raw row AFTER the finalize already computed counts →
  "final counts behind staged rows."
- **Fix:** `stageRawData` is a single CTE: `lease AS (SELECT 1 FROM migration_jobs
  WHERE id=$id AND lease_token=$tok AND status='extracting' FOR UPDATE)`, then the
  INSERT fires only `WHERE EXISTS(SELECT 1 FROM lease)` with `ON CONFLICT DO NOTHING`,
  returning `held=EXISTS(lease)` and `inserted=EXISTS(ins)`. A locking CTE is always
  materialized, so the `FOR UPDATE` row lock on the job row is taken as part of deciding
  the insert. This serializes staging against the claim path's `FOR UPDATE SKIP LOCKED`
  and the finalize/progress `UPDATE`s. Either order is safe: finalize-first →
  EvalPlanQual re-reads, WHERE fails, `held=false`, nothing inserts; staging-first →
  finalize blocks, its projection includes the staged row.

**How to apply:** every worker write helper is fenced on `(id, lease_token)` and returns
whether it still held the lease; the worker calls a `leaseLost()` abort the moment any
returns false/`held=false` — BEFORE advancing the cursor / heartbeating / staging more.
`FOR UPDATE`-in-CTE is valid Postgres and verified on the live DB. All paths lock the
single job row (no lock-order inversion; claim uses SKIP LOCKED so it never waits) → no
deadlock. The posts step parks the job 'failed' if a non-empty conversations page yields
0 extractable ids (silent-extraction-success guard).

## List pagination is 0-based; the page index leaks into staged record keys
The TextLine list API is **0-based** (`page=0..n` until empty) — start at page 0 or you
**skip the first page = silent data loss**. The single source of truth is
`PAGE_START=0` in `textlineClient.ts`; the worker inits/resets every entity to
`PAGE_START`. Coupled sites that broke when flipping 1→0-based:
- `getMaxStagedPage` must return **-1** for "no rows" (0 is now a valid page; it used
  to double as the "none" sentinel). `runPostsStep` guard becomes `maxConvPage < 0`.
- `detectHasMore` `total_pages` branch is `page < totalPages - 1` (last index =
  total-1) so it doesn't over-fetch/stage an empty trailing page. Unknown metadata
  still fetches until an empty page (safe; never skips).
- **Hidden trap:** the page index is baked into staged `record_key`s
  (`${entity}:p${page}`). A non-paginated entity (e.g. **agents**) now stages at
  `agents:p0`, so any reader hardcoding `agents:p1` silently reads null (lost
  sender/agent attribution). Grep every literal `:p1`/`:pN` record-key lookup when
  changing the page base; `readAgentsPayload` reads `agents:p0` with a legacy
  `agents:p1` fallback for in-flight resumes.
**Why:** Phase 3 reads staged rows by `ORDER BY id OFFSET/LIMIT` (insulated), so the
page base only matters in extraction + the literal record-key readers — the easy ones
to miss.
