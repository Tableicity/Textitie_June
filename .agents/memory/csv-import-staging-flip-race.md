---
name: CSV/staged import staging→flip race
description: For "stage then flip-live" imports, resolve insert-vs-update/skip from flip-time DB state, not the stale upload-time duplicate classification.
---

# Staged-import staging→flip duplicate race

**Rule:** For any "stage rows now, operator flips them live later" importer
(CSV Contact Import, TextLine Migration), decide insert-vs-update/skip from the
**flip-time** DB state, never from the upload-time duplicate classification.
Implement the flip as a single atomic `INSERT ... SELECT ... ON CONFLICT
(<partial unique index>) DO UPDATE` (for the "update" resolution) or `DO NOTHING`
(for "skip") over the **union of every non-invalid staged row** (both the rows
staged `valid` and the ones staged `duplicate`). Count inserts vs updates with
`RETURNING (xmax = 0) AS inserted` (true = fresh insert, false = conflict-update).
`skippedDuplicates = distinctCandidatePhones - inserted`.

**Why:** upload-time classification goes stale. A row classified `valid`
(no live contact at upload) can become a live duplicate before the operator
flips — inbound SMS, a manual contact add, or another import all create contacts
in the window, and **none of them take the migration advisory lock**
(that lock only serializes migration/CSV flips against each other, not normal
contact creation). With a naive flip that inserts only the `valid` rows via
`ON CONFLICT DO NOTHING` and applies update/skip only to the upload-time
`duplicate` rows, such a raced row is **silently dropped**: not inserted, not
routed through the operator's update/skip choice, and the counts under-report.

**How to apply:** whenever you add a staged-import lane, do not trust
staging-time dedup at flip — re-resolve atomically against live state. Use
`DISTINCT ON (phone) ... ORDER BY phone, row_number DESC` inside the SELECT so
within-file repeats collapse to one row per phone (last wins); otherwise a bulk
`ON CONFLICT DO UPDATE` errors with "cannot affect row a second time". The
partial unique index target must match the live-contact predicate (e.g.
`(tenant_id, phone) WHERE is_quarantined = false`) so quarantined rows don't
falsely conflict. Verified by reproducing the race live: stage a `valid` row,
INSERT a colliding live contact, then flip — update→updates it, skip→counts it.
