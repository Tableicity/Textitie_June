import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { MIGRATION_LOCK } from "./migrationStore";

/**
 * CSV Contact Import — operator flip-live / discard actions.
 *
 * A self-contained sibling of migrationActions.ts; the TextLine Migration build
 * is NOT touched. We DO reuse the migration per-tenant advisory lock constant
 * (MIGRATION_LOCK, imported read-only) so a CSV flip and a TextLine flip for the
 * same tenant serialize and can never race on the contacts
 * (tenant_id, phone) WHERE is_quarantined=false partial unique index.
 *
 * Staged rows live in csv_import_rows (OUTSIDE the live contacts table).
 * flip-live is the ONLY path that writes live contacts; discard just deletes
 * the staging rows. Both actions run in ONE transaction holding the advisory
 * lock, are idempotent, and are tenant_id + job scoped.
 */

export type DuplicateResolution = "update" | "skip";

export type FlipCsvResult =
  | { ok: true }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "not_ready"; current: string };

export type DiscardCsvResult =
  | { ok: true }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "not_discardable"; current: string };

function firstRow(result: {
  rows: unknown[];
}): Record<string, unknown> | undefined {
  return (result.rows as Record<string, unknown>[])[0];
}

function rowCount(result: { rowCount?: number | null }): number {
  return result.rowCount ?? 0;
}

/**
 * Reveal a staged CSV import: INSERT its 'valid' rows as new live contacts and
 * resolve its 'duplicate' rows (phone already a live contact) per the operator's
 * per-import choice (update the existing contact vs skip). Idempotent: a
 * re-click on an already-flipped job is a no-op success.
 */
export async function flipCsvImportLive(
  tenantId: number,
  jobId: number,
  resolution: DuplicateResolution,
): Promise<FlipCsvResult> {
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${tenantId}, ${MIGRATION_LOCK})`,
    );

    const job = firstRow(
      await tx.execute(sql`
        SELECT id, status, summary
        FROM csv_import_jobs
        WHERE id = ${jobId} AND tenant_id = ${tenantId}
        FOR UPDATE
      `),
    );
    if (!job) return { ok: false, reason: "missing" };
    if (job.status === "complete") return { ok: true }; // idempotent replay
    if (job.status !== "review") {
      return { ok: false, reason: "not_ready", current: String(job.status) };
    }

    // Resolve against flip-time DB state, NOT the upload-time classification.
    // A row staged 'valid' whose phone becomes a live contact between staging
    // and flip (inbound SMS, a manual add, another import — none of which take
    // this advisory lock) is a live duplicate NOW and must follow the operator's
    // update/skip choice, never be silently dropped. So both 'valid' and
    // 'duplicate' staged rows are the candidate set; the DB decides insert vs
    // resolve per phone atomically. DISTINCT ON (phone) collapses within-file
    // repeats (last row wins) so a single upsert can't touch a conflict row
    // twice.
    const distinctCandidates = Number(
      firstRow(
        await tx.execute(sql`
          SELECT COUNT(DISTINCT phone)::int AS c
          FROM csv_import_rows
          WHERE job_id = ${jobId} AND tenant_id = ${tenantId}
            AND status IN ('valid', 'duplicate') AND phone IS NOT NULL
        `),
      )?.c ?? 0,
    );

    let inserted = 0;
    let updated = 0;
    let skippedDuplicates = 0;

    if (resolution === "update") {
      // Atomic INSERT ... ON CONFLICT DO UPDATE: each candidate phone is
      // inserted when new or updated in place when a live contact already
      // exists at flip time, in ONE statement — so the staging->flip window
      // can't drop a now-duplicate row. `xmax = 0` distinguishes a fresh insert
      // from a conflict-update in RETURNING. Provided fields overwrite; nulls
      // keep the existing value; tags union.
      const rows = (
        await tx.execute(sql`
          INSERT INTO contacts
            (tenant_id, phone, name, email, location, notes, tags, is_quarantined)
          SELECT s.tenant_id, s.phone, s.name, s.email, s.location, s.notes, s.tags, false
          FROM (
            SELECT DISTINCT ON (phone)
              tenant_id, phone, name, email, location, notes, tags, row_number
            FROM csv_import_rows
            WHERE job_id = ${jobId} AND tenant_id = ${tenantId}
              AND status IN ('valid', 'duplicate') AND phone IS NOT NULL
            ORDER BY phone, row_number DESC
          ) s
          ON CONFLICT (tenant_id, phone) WHERE (is_quarantined = false)
          DO UPDATE SET
            name = COALESCE(EXCLUDED.name, contacts.name),
            email = COALESCE(EXCLUDED.email, contacts.email),
            location = COALESCE(EXCLUDED.location, contacts.location),
            notes = COALESCE(EXCLUDED.notes, contacts.notes),
            tags = CASE
              WHEN EXCLUDED.tags IS NULL THEN contacts.tags
              ELSE ARRAY(SELECT DISTINCT unnest(COALESCE(contacts.tags, '{}'::text[]) || EXCLUDED.tags))
            END,
            updated_at = now()
          RETURNING (xmax = 0) AS inserted
        `)
      ).rows as { inserted: boolean }[];
      for (const r of rows) {
        if (r.inserted) inserted += 1;
        else updated += 1;
      }
    } else {
      // skip: insert every candidate that has no live contact NOW; anything
      // that collides (a real live duplicate at flip time) is skipped + counted
      // from flip-time reality rather than the upload-time tally.
      inserted = rowCount(
        await tx.execute(sql`
          INSERT INTO contacts
            (tenant_id, phone, name, email, location, notes, tags, is_quarantined)
          SELECT s.tenant_id, s.phone, s.name, s.email, s.location, s.notes, s.tags, false
          FROM (
            SELECT DISTINCT ON (phone)
              tenant_id, phone, name, email, location, notes, tags, row_number
            FROM csv_import_rows
            WHERE job_id = ${jobId} AND tenant_id = ${tenantId}
              AND status IN ('valid', 'duplicate') AND phone IS NOT NULL
            ORDER BY phone, row_number DESC
          ) s
          ON CONFLICT (tenant_id, phone) WHERE (is_quarantined = false)
          DO NOTHING
          RETURNING id
        `),
      );
      skippedDuplicates = distinctCandidates - inserted;
    }

    const prevSummary = (job.summary as Record<string, unknown> | null) ?? {};
    const mergedSummary = {
      ...prevSummary,
      flippedAt: new Date().toISOString(),
      duplicateResolution: resolution,
      inserted,
      updated,
      skippedDuplicates,
    };

    await tx.execute(sql`
      UPDATE csv_import_jobs
      SET status = 'complete',
          summary = ${JSON.stringify(mergedSummary)}::jsonb,
          updated_at = now()
      WHERE id = ${jobId} AND tenant_id = ${tenantId}
    `);

    return { ok: true };
  });
}

/**
 * Discard a staged CSV import: delete its staging rows and mark the job
 * discarded. Staging lives OUTSIDE the live contacts table, so this never
 * touches live data. Idempotent.
 */
export async function discardCsvImport(
  tenantId: number,
  jobId: number,
): Promise<DiscardCsvResult> {
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${tenantId}, ${MIGRATION_LOCK})`,
    );

    const job = firstRow(
      await tx.execute(sql`
        SELECT id, status
        FROM csv_import_jobs
        WHERE id = ${jobId} AND tenant_id = ${tenantId}
        FOR UPDATE
      `),
    );
    if (!job) return { ok: false, reason: "missing" };
    if (job.status === "discarded") return { ok: true }; // idempotent replay
    if (job.status !== "review") {
      return {
        ok: false,
        reason: "not_discardable",
        current: String(job.status),
      };
    }

    await tx.execute(sql`
      DELETE FROM csv_import_rows
      WHERE job_id = ${jobId} AND tenant_id = ${tenantId}
    `);
    await tx.execute(sql`
      UPDATE csv_import_jobs
      SET status = 'discarded', updated_at = now()
      WHERE id = ${jobId} AND tenant_id = ${tenantId}
    `);

    return { ok: true };
  });
}
