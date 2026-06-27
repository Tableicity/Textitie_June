import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { MIGRATION_LOCK } from "./migrationStore";

// ---------------------------------------------------------------------------
// TextLine Smasher — Phase 3 operator actions (hydrate gate / flip-live /
// discard). These are the Conductor-driven state transitions that bracket the
// worker's hydrate stage. They live here (not in migrationStore, which stays
// worker-focused) and each runs inside ONE transaction holding
// pg_advisory_xact_lock(tenantId, MIGRATION_LOCK) so they can never interleave
// with a hydrate batch (which takes the same lock) over the same tenant.
//
// Hard invariants enforced here:
//   - NEVER delete or expose a live (is_quarantined=false) row.
//   - flip clears quarantine only after proving no (tenant,phone) collision
//     remains, so the partial unique index can never 23505 mid-flip.
//   - every mutation is tenant_id + migration_job_id scoped.
//   - all three actions are idempotent (re-running a flipped/discarded job is a
//     no-op that returns the current state).
// ---------------------------------------------------------------------------

function rows(result: { rows: unknown[] }): Record<string, unknown>[] {
  return result.rows as Record<string, unknown>[];
}

/**
 * Extract a Postgres SQLSTATE code from an error, walking the `cause` chain.
 * Drizzle wraps the driver error in a DrizzleQueryError, so the original pg
 * error (carrying `code`) sits on `err.cause` — checking the top-level `err.code`
 * alone silently misses a real 23505 and would 500 instead of reporting it.
 */
export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

function rowCount(result: { rowCount?: number | null }): number {
  return result.rowCount ?? 0;
}

/** Thrown to roll back a flip transaction when a real collision is found. */
class FlipCollision extends Error {
  constructor(public phones: string[]) {
    super("flip collision");
    this.name = "FlipCollision";
  }
}

// --- Hydrate gate (review -> hydrating) --------------------------------------

export type HydrateGateResult =
  | { status: "queued" }
  | { status: "already_queued" }
  | { status: "not_ready"; current: string };

/**
 * Open the hydrate stage by flipping a job from 'review' to 'hydrating' with a
 * fresh resume cursor. Conditional UPDATE so only a job actually parked at the
 * operator review gate can be queued; a re-click while already hydrating is a
 * benign no-op. Lease + attempts are reset so the Phase-3 worker claims it clean.
 */
export async function transitionToHydrating(
  tenantId: number,
  jobId: number,
): Promise<HydrateGateResult> {
  const upd = await db.execute(sql`
    UPDATE migration_jobs
    SET status = 'hydrating',
        page_cursor = 0,
        lease_token = NULL,
        leased_until = NULL,
        rate_limited_until = NULL,
        attempts = 0,
        last_error = NULL,
        updated_at = now()
    WHERE id = ${jobId} AND tenant_id = ${tenantId} AND status = 'review'
    RETURNING id
  `);
  if (rows(upd).length > 0) return { status: "queued" };

  const cur = rows(
    await db.execute(sql`
      SELECT status FROM migration_jobs
      WHERE id = ${jobId} AND tenant_id = ${tenantId}
    `),
  )[0];
  const status = cur ? String(cur.status) : "missing";
  if (status === "hydrating") return { status: "already_queued" };
  return { status: "not_ready", current: status };
}

// --- Flip live (complete -> quarantine cleared) -----------------------------

export type FlipResult =
  | { status: "ok"; merged: number }
  | { status: "already_flipped" }
  | { status: "not_complete"; current: string }
  | { status: "collision"; phones: string[] };

/**
 * Reveal a completed migration's data by clearing is_quarantined on its
 * contacts/conversations/messages. Before clearing it reconciles any phone that
 * gained a live contact since hydrate: repoint this job's conversations onto the
 * live contact and drop the now-duplicate quarantined contact, then PROVE no
 * (tenant,phone) collision remains. Idempotent via summary.flippedAt.
 */
export async function flipMigrationLive(
  tenantId: number,
  jobId: number,
): Promise<FlipResult> {
  try {
    return await db.transaction(async (tx) => {
      const job = rows(
        await tx.execute(sql`
          SELECT status, summary FROM migration_jobs
          WHERE id = ${jobId} AND tenant_id = ${tenantId}
          FOR UPDATE
        `),
      )[0];
      // loadJob in the route already 404s a missing job; defensive here.
      if (!job) return { status: "not_complete", current: "missing" };
      const status = String(job.status);
      const summary = (job.summary as Record<string, unknown> | null) ?? {};
      if (status === "complete" && summary.flippedAt) {
        return { status: "already_flipped" };
      }
      if (status !== "complete") return { status: "not_complete", current: status };

      // Serialize against the hydrate worker for this tenant.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}, ${MIGRATION_LOCK})`);

      // 1. Repoint this job's conversations from a quarantined contact onto the
      //    live contact that now owns the same phone.
      await tx.execute(sql`
        UPDATE conversations c
        SET contact_id = l.id
        FROM contacts q
        JOIN contacts l
          ON l.tenant_id = q.tenant_id
         AND l.phone = q.phone
         AND l.is_quarantined = false
        WHERE c.contact_id = q.id
          AND c.migration_job_id = ${jobId}
          AND q.migration_job_id = ${jobId}
          AND q.is_quarantined = true
          AND q.tenant_id = ${tenantId}
      `);

      // 2. Delete the now-merged duplicate quarantined contacts.
      const del = await tx.execute(sql`
        DELETE FROM contacts q
        USING contacts l
        WHERE q.migration_job_id = ${jobId}
          AND q.is_quarantined = true
          AND q.tenant_id = ${tenantId}
          AND l.tenant_id = q.tenant_id
          AND l.phone = q.phone
          AND l.is_quarantined = false
      `);
      const merged = rowCount(del);

      // 3. Prove no quarantined phone in this job still collides with a live
      //    contact (would 23505 the clear). Should be empty after the merge.
      const collisions = rows(
        await tx.execute(sql`
          SELECT DISTINCT q.phone
          FROM contacts q
          WHERE q.migration_job_id = ${jobId}
            AND q.is_quarantined = true
            AND q.tenant_id = ${tenantId}
            AND EXISTS (
              SELECT 1 FROM contacts l
              WHERE l.tenant_id = q.tenant_id
                AND l.phone = q.phone
                AND l.is_quarantined = false
            )
          LIMIT 50
        `),
      ).map((r) => String(r.phone));
      if (collisions.length > 0) throw new FlipCollision(collisions);

      // 4. Clear quarantine — order is irrelevant (no FK depends on the flag).
      await tx.execute(sql`
        UPDATE contacts SET is_quarantined = false, updated_at = now()
        WHERE migration_job_id = ${jobId} AND is_quarantined = true AND tenant_id = ${tenantId}
      `);
      await tx.execute(sql`
        UPDATE conversations SET is_quarantined = false
        WHERE migration_job_id = ${jobId} AND is_quarantined = true AND tenant_id = ${tenantId}
      `);
      // messages has no tenant_id of its own — scope via its conversation's
      // tenant so the mutation can never cross a tenant boundary even if a
      // migration_job_id were ever mis-associated.
      await tx.execute(sql`
        UPDATE messages SET is_quarantined = false
        WHERE migration_job_id = ${jobId} AND is_quarantined = true
          AND conversation_id IN (
            SELECT id FROM conversations WHERE tenant_id = ${tenantId}
          )
      `);

      // 5. Stamp flippedAt (idempotency marker) without disturbing the summary.
      await tx.execute(sql`
        UPDATE migration_jobs
        SET summary = COALESCE(summary, '{}'::jsonb) || jsonb_build_object('flippedAt', to_jsonb(now())),
            updated_at = now()
        WHERE id = ${jobId} AND tenant_id = ${tenantId}
      `);

      return { status: "ok", merged };
    });
  } catch (err) {
    if (err instanceof FlipCollision) return { status: "collision", phones: err.phones };
    // A concurrently-created live contact could still 23505 the clear despite
    // the advisory lock (normal app contact writes aren't under it) — surface it
    // as a retryable collision rather than a 500. The code lives on the wrapped
    // driver error's cause chain (Drizzle wraps it), so unwrap before matching.
    if (pgErrorCode(err) === "23505") {
      return { status: "collision", phones: [] };
    }
    throw err;
  }
}

// --- Discard (delete quarantined + staged) ----------------------------------

export type DiscardResult =
  | { status: "ok"; deleted: { messages: number; conversations: number; contacts: number } }
  | { status: "already_discarded" }
  | { status: "forbidden"; current: string; flipped: boolean };

// A job may only be discarded from a quiescent, operator-facing state — never
// while a worker can be mid-write (pending/extracting/extracted/verifying/
// hydrating) and never after it has been flipped live.
const DISCARDABLE = new Set(["review", "verified", "failed", "complete"]);

/**
 * Permanently delete a migration's QUARANTINED rows + staged raw data and park
 * the job 'discarded'. Every delete is is_quarantined=true scoped so a live row
 * (including a live contact this job's conversations were linked to) is never
 * touched. Idempotent: re-discarding returns already_discarded.
 */
export async function discardMigration(
  tenantId: number,
  jobId: number,
): Promise<DiscardResult> {
  return await db.transaction(async (tx) => {
    const job = rows(
      await tx.execute(sql`
        SELECT status, summary FROM migration_jobs
        WHERE id = ${jobId} AND tenant_id = ${tenantId}
        FOR UPDATE
      `),
    )[0];
    if (!job) return { status: "forbidden", current: "missing", flipped: false };
    const status = String(job.status);
    if (status === "discarded") return { status: "already_discarded" };
    const summary = (job.summary as Record<string, unknown> | null) ?? {};
    const flipped = Boolean(summary.flippedAt);
    if (!DISCARDABLE.has(status) || (status === "complete" && flipped)) {
      return { status: "forbidden", current: status, flipped };
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}, ${MIGRATION_LOCK})`);

    // messages -> conversations (FK order); contacts only when quarantined so a
    // live contact we linked conversations to survives. raw_data is job-scoped.
    // messages has no tenant_id — scope via its conversation's tenant so the
    // delete can never cross a tenant boundary.
    const m = await tx.execute(sql`
      DELETE FROM messages
      WHERE migration_job_id = ${jobId} AND is_quarantined = true
        AND conversation_id IN (
          SELECT id FROM conversations WHERE tenant_id = ${tenantId}
        )
    `);
    const c = await tx.execute(sql`
      DELETE FROM conversations
      WHERE migration_job_id = ${jobId} AND is_quarantined = true AND tenant_id = ${tenantId}
    `);
    const ct = await tx.execute(sql`
      DELETE FROM contacts
      WHERE migration_job_id = ${jobId} AND is_quarantined = true AND tenant_id = ${tenantId}
    `);
    await tx.execute(sql`
      DELETE FROM migration_raw_data
      WHERE job_id = ${jobId} AND tenant_id = ${tenantId}
    `);
    await tx.execute(sql`
      UPDATE migration_jobs
      SET status = 'discarded',
          access_token_enc = NULL,
          lease_token = NULL,
          leased_until = NULL,
          updated_at = now()
      WHERE id = ${jobId} AND tenant_id = ${tenantId}
    `);

    return {
      status: "ok",
      deleted: { messages: rowCount(m), conversations: rowCount(c), contacts: rowCount(ct) },
    };
  });
}
