import { randomUUID } from "node:crypto";
import {
  db,
  migrationJobsTable,
  migrationRawDataTable,
  conversationsTable,
  messagesTable,
  contactsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { NormalizedConversation, MigrationSummary } from "./migrationTransform";

/**
 * Advisory-lock key for migration write bursts (hydrate batches, flip-live,
 * discard). Distinct from classroomPublish's CLASSROOM_PUSH_LOCK (0) so the two
 * never contend; serializes per (tenantId, MIGRATION_LOCK).
 */
export const MIGRATION_LOCK = 1;

// ---------------------------------------------------------------------------
// Durable, crash-safe store for the TextLine migration extraction worker.
//
// A migration runs over MANY worker ticks (a multi-year pull can take a long
// time), so the worker must:
//   - claim a job atomically (FOR UPDATE SKIP LOCKED) and FENCE its work with a
//     lease_token, so a paused/old worker can never write after a new worker
//     reclaims an expired lease;
//   - persist the resume cursor (current_entity + page_cursor) after every page;
//   - stage raw pages idempotently (UNIQUE(job_id, record_key)) so a resume or
//     retry never double-stages;
//   - park on 429 (rate_limited_until) and back off on transient errors, while
//     keeping `attempts` a CONSECUTIVE-FAILURE counter (reset on any progress).
//
// `counts` is NOT tracked in memory: it is a PROJECTION recomputed from
// migration_raw_data (SUM of record_count per entity) INSIDE each fenced write,
// so it can never desync from the rows actually staged — crash-safe (a crash
// between insert and cursor-save self-heals) and stale-worker-safe (idempotent
// inserts don't double-count). Every mutating helper is fenced on
// `(id, lease_token)` and returns whether it still held the lease; the worker
// aborts the moment it loses the lease.
// ---------------------------------------------------------------------------

const MAX_ERROR_LEN = 2_000;

// The worker only ever claims jobs it knows how to drive forward: a fresh
// `pending` job or one already mid-`extracting`. It must NEVER touch the human
// review gate, the Phase 3 hydrate state, or any terminal job.
export const CLAIMABLE_STATUSES = ["pending", "extracting"] as const;

export interface ClaimedMigrationJob {
  id: number;
  tenantId: number;
  status: string;
  currentEntity: string | null;
  pageCursor: number;
  counts: Record<string, number>;
  accessTokenEnc: string | null;
  attempts: number;
  /** The fencing token minted for THIS claim; required by every later write. */
  leaseToken: string;
}

function rows(result: { rows: unknown[] }): Record<string, unknown>[] {
  return result.rows as Record<string, unknown>[];
}

/**
 * The single source of truth for `counts`: SUM(record_count) per entity over the
 * rows ACTUALLY staged in migration_raw_data, as a jsonb object. Embedded inside
 * each fenced write so the persisted counts always match staged data — immune to
 * crashes between insert and cursor-save and to idempotent re-inserts on resume.
 */
function countsProjectionSql(id: number) {
  return sql`COALESCE((
    SELECT jsonb_object_agg(s.entity, s.total)
    FROM (
      SELECT entity, SUM(record_count)::int AS total
      FROM migration_raw_data
      WHERE job_id = ${id}
      GROUP BY entity
    ) s
  ), '{}'::jsonb)`;
}

function toCounts(value: unknown): Record<string, number> {
  return (value as Record<string, number> | null) ?? {};
}

/**
 * Atomically claim the oldest eligible job and stamp it with a fresh lease.
 * Eligible = claimable status AND lease free/expired AND not rate-limited.
 * Sets status='extracting' (idempotent for an already-extracting resume).
 * Does NOT touch `attempts` — that counter tracks failures, not claims.
 */
export async function claimNextMigrationJob(
  leaseMs: number,
): Promise<ClaimedMigrationJob | null> {
  const leaseToken = randomUUID();
  const result = await db.execute(sql`
    UPDATE migration_jobs AS j
    SET status = 'extracting',
        lease_token = ${leaseToken},
        leased_until = now() + make_interval(secs => ${leaseMs} / 1000.0),
        updated_at = now()
    WHERE j.id = (
      SELECT cand.id
      FROM migration_jobs AS cand
      WHERE cand.status IN ('pending', 'extracting')
        AND (cand.leased_until IS NULL OR cand.leased_until <= now())
        AND (cand.rate_limited_until IS NULL OR cand.rate_limited_until <= now())
      ORDER BY cand.rate_limited_until ASC NULLS FIRST, cand.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING j.id, j.tenant_id, j.status, j.current_entity, j.page_cursor,
              j.counts, j.access_token_enc, j.attempts, j.lease_token
  `);
  const row = rows(result)[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    status: String(row.status),
    currentEntity: (row.current_entity as string | null) ?? null,
    pageCursor: Number(row.page_cursor ?? 0),
    counts: (row.counts as Record<string, number>) ?? {},
    accessTokenEnc: (row.access_token_enc as string | null) ?? null,
    attempts: Number(row.attempts ?? 0),
    leaseToken,
  };
}

/** Extend the lease while a long page/chunk is in flight. False => lease lost. */
export async function heartbeatMigrationLease(
  id: number,
  leaseToken: string,
  leaseMs: number,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE migration_jobs
    SET leased_until = now() + make_interval(secs => ${leaseMs} / 1000.0),
        updated_at = now()
    WHERE id = ${id} AND lease_token = ${leaseToken}
    RETURNING id
  `);
  return rows(result).length > 0;
}

/**
 * Persist extraction progress (entity + cursor) and extend the lease in one
 * fenced step. `counts` is recomputed from staged rows atomically here (not
 * passed in), so it always matches reality. Resets `attempts` to 0 because
 * making progress means the job is healthy. False => the lease was lost; the
 * caller must stop.
 */
export async function saveExtractionProgress(opts: {
  id: number;
  leaseToken: string;
  currentEntity: string;
  pageCursor: number;
  leaseMs: number;
}): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE migration_jobs
    SET current_entity = ${opts.currentEntity},
        page_cursor = ${opts.pageCursor},
        counts = ${countsProjectionSql(opts.id)},
        attempts = 0,
        last_error = NULL,
        leased_until = now() + make_interval(secs => ${opts.leaseMs} / 1000.0),
        updated_at = now()
    WHERE id = ${opts.id} AND lease_token = ${opts.leaseToken}
    RETURNING id
  `);
  return rows(result).length > 0;
}

/**
 * Stage one raw unit (a list page or one conversation's detail) idempotently AND
 * under the lease fence, atomically, in a single statement:
 *   - the INSERT only fires if THIS worker still holds the lease (matching
 *     lease_token AND status='extracting'), so a stale/old worker can NEVER write
 *     a raw row after a newer worker reclaimed the job or it advanced terminally;
 *   - ON CONFLICT DO NOTHING keeps it idempotent across resume/retry.
 * Returns `held` (false => lease lost; caller must abort) and `inserted` (false
 * => duplicate / lease lost). Counts are NOT derived from `inserted` — they are
 * recomputed from the staged rows in the fenced progress write — so this flag is
 * for logging/short-circuit only.
 */
export async function stageRawData(opts: {
  jobId: number;
  tenantId: number;
  leaseToken: string;
  entity: string;
  page: number;
  recordKey: string;
  payload: unknown;
  recordCount: number;
}): Promise<{ held: boolean; inserted: boolean }> {
  const result = await db.execute(sql`
    WITH lease AS (
      SELECT 1
      FROM migration_jobs
      WHERE id = ${opts.jobId}
        AND lease_token = ${opts.leaseToken}
        AND status = 'extracting'
      FOR UPDATE
    ),
    ins AS (
      INSERT INTO migration_raw_data
        (job_id, tenant_id, entity, page, record_key, payload, record_count)
      SELECT ${opts.jobId}, ${opts.tenantId}, ${opts.entity}, ${opts.page},
             ${opts.recordKey}, ${JSON.stringify(opts.payload)}::jsonb,
             ${opts.recordCount}
      WHERE EXISTS (SELECT 1 FROM lease)
      ON CONFLICT (job_id, record_key) DO NOTHING
      RETURNING id
    )
    SELECT
      EXISTS (SELECT 1 FROM lease) AS held,
      EXISTS (SELECT 1 FROM ins) AS inserted
  `);
  const row = rows(result)[0];
  return {
    held: Boolean(row?.held),
    inserted: Boolean(row?.inserted),
  };
}

/** Cheap indexed existence check (uses UNIQUE(job_id, record_key)). */
export async function isRawStaged(
  jobId: number,
  recordKey: string,
): Promise<boolean> {
  const found = await db
    .select({ id: migrationRawDataTable.id })
    .from(migrationRawDataTable)
    .where(
      and(
        eq(migrationRawDataTable.jobId, jobId),
        eq(migrationRawDataTable.recordKey, recordKey),
      ),
    )
    .limit(1);
  return found.length > 0;
}

/**
 * Read one staged page blob plus its recorded count (e.g. a conversations page)
 * for re-derivation. `recordCount` lets the posts step distinguish a genuinely
 * empty page from a non-empty page whose ids we failed to extract (an anomaly).
 */
export async function getStagedPage(
  jobId: number,
  entity: string,
  page: number,
): Promise<{ payload: unknown; recordCount: number } | null> {
  const [row] = await db
    .select({
      payload: migrationRawDataTable.payload,
      recordCount: migrationRawDataTable.recordCount,
    })
    .from(migrationRawDataTable)
    .where(
      and(
        eq(migrationRawDataTable.jobId, jobId),
        eq(migrationRawDataTable.recordKey, `${entity}:p${page}`),
      ),
    )
    .limit(1);
  return row ? { payload: row.payload, recordCount: Number(row.recordCount ?? 0) } : null;
}

/** Highest staged page number for an entity (0 when none) — posts-stage bound. */
export async function getMaxStagedPage(
  jobId: number,
  entity: string,
): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(page), 0) AS max_page
    FROM migration_raw_data
    WHERE job_id = ${jobId} AND entity = ${entity}
  `);
  const row = rows(result)[0];
  return row ? Number(row.max_page ?? 0) : 0;
}

/**
 * Finish extraction: advance to 'extracted', clear the access token (no longer
 * needed — verify/hydrate read only staged JSONB), and drop the lease + cursor.
 * Recomputes the final counts from staged rows and returns them with the
 * lease-held flag. `held=false` => another worker reclaimed the job mid-tick;
 * the caller must NOT assume it finished the extraction.
 */
export async function markMigrationExtracted(
  id: number,
  leaseToken: string,
): Promise<{ held: boolean; counts: Record<string, number> }> {
  const result = await db.execute(sql`
    UPDATE migration_jobs
    SET status = 'extracted',
        counts = ${countsProjectionSql(id)},
        access_token_enc = NULL,
        current_entity = NULL,
        rate_limited_until = NULL,
        attempts = 0,
        last_error = NULL,
        lease_token = NULL,
        leased_until = NULL,
        updated_at = now()
    WHERE id = ${id} AND lease_token = ${leaseToken}
    RETURNING counts
  `);
  const row = rows(result)[0];
  return { held: !!row, counts: row ? toCounts(row.counts) : {} };
}

/** Park the job until `untilMs` from now on a 429; release the lease.
 * False => lease already lost (another worker owns it). */
export async function rateLimitMigrationJob(
  id: number,
  leaseToken: string,
  untilMs: number,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE migration_jobs
    SET rate_limited_until = now() + make_interval(secs => ${untilMs} / 1000.0),
        attempts = 0,
        lease_token = NULL,
        leased_until = NULL,
        updated_at = now()
    WHERE id = ${id} AND lease_token = ${leaseToken}
    RETURNING id
  `);
  return rows(result).length > 0;
}

/** Yield mid-extraction (budget exhausted): drop the lease, stay claimable.
 * False => lease already lost (benign: another worker took over). */
export async function releaseMigrationLease(
  id: number,
  leaseToken: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE migration_jobs
    SET lease_token = NULL, leased_until = NULL, updated_at = now()
    WHERE id = ${id} AND lease_token = ${leaseToken}
    RETURNING id
  `);
  return rows(result).length > 0;
}

/**
 * Record a transient failure: bump the consecutive-failure counter, stash the
 * error, set a short backoff via rate_limited_until, and release the lease.
 * False => lease already lost (another worker owns it).
 */
export async function backoffMigrationJob(
  id: number,
  leaseToken: string,
  attempts: number,
  backoffMs: number,
  error: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE migration_jobs
    SET attempts = ${attempts},
        last_error = ${error.slice(0, MAX_ERROR_LEN)},
        rate_limited_until = now() + make_interval(secs => ${backoffMs} / 1000.0),
        lease_token = NULL,
        leased_until = NULL,
        updated_at = now()
    WHERE id = ${id} AND lease_token = ${leaseToken}
    RETURNING id
  `);
  return rows(result).length > 0;
}

/** Park the job 'failed' (terminal) and clear the credential.
 * False => lease already lost (another worker owns it). */
export async function failMigrationJob(
  id: number,
  leaseToken: string,
  error: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE migration_jobs
    SET status = 'failed',
        last_error = ${error.slice(0, MAX_ERROR_LEN)},
        access_token_enc = NULL,
        lease_token = NULL,
        leased_until = NULL,
        updated_at = now()
    WHERE id = ${id} AND lease_token = ${leaseToken}
    RETURNING id
  `);
  return rows(result).length > 0;
}

// ===========================================================================
// Phase 3 — verify + hydrate worker store
//
// The Phase 3 worker drives the post-extraction stages the extraction worker
// never touches: extracted -> verifying -> review (a deterministic summary pass,
// no writes except the final summary) and review -> hydrating -> complete (the
// idempotent promotion into quarantined live rows). It claims a DIFFERENT,
// disjoint status set (extracted|verifying|hydrating) under the SAME lease fence,
// so the two workers can never claim the same job.
// ===========================================================================

/**
 * Atomically claim the oldest Phase-3-eligible job under a fresh lease. Eligible
 * = status in (extracted|verifying|hydrating) AND lease free/expired. An
 * 'extracted' job is advanced to 'verifying' on claim; a 'verifying' (crash
 * resume) or 'hydrating' job keeps its status. Returns the POST-claim status so
 * the worker knows whether to verify or hydrate.
 */
export async function claimNextPhase3Job(
  leaseMs: number,
): Promise<ClaimedMigrationJob | null> {
  const leaseToken = randomUUID();
  const result = await db.execute(sql`
    UPDATE migration_jobs AS j
    SET status = CASE WHEN j.status = 'extracted' THEN 'verifying' ELSE j.status END,
        lease_token = ${leaseToken},
        leased_until = now() + make_interval(secs => ${leaseMs} / 1000.0),
        updated_at = now()
    WHERE j.id = (
      SELECT cand.id
      FROM migration_jobs AS cand
      WHERE cand.status IN ('extracted', 'verifying', 'hydrating')
        AND (cand.leased_until IS NULL OR cand.leased_until <= now())
        AND (cand.rate_limited_until IS NULL OR cand.rate_limited_until <= now())
      ORDER BY cand.rate_limited_until ASC NULLS FIRST, cand.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING j.id, j.tenant_id, j.status, j.current_entity, j.page_cursor,
              j.counts, j.access_token_enc, j.attempts, j.lease_token
  `);
  const row = rows(result)[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    status: String(row.status),
    currentEntity: (row.current_entity as string | null) ?? null,
    pageCursor: Number(row.page_cursor ?? 0),
    counts: (row.counts as Record<string, number>) ?? {},
    accessTokenEnc: (row.access_token_enc as string | null) ?? null,
    attempts: Number(row.attempts ?? 0),
    leaseToken,
  };
}

/** The single staged agents blob (agents:p1), for sender-role attribution. */
export async function readAgentsPayload(jobId: number): Promise<unknown | null> {
  const [row] = await db
    .select({ payload: migrationRawDataTable.payload })
    .from(migrationRawDataTable)
    .where(
      and(
        eq(migrationRawDataTable.jobId, jobId),
        eq(migrationRawDataTable.recordKey, "agents:p1"),
      ),
    )
    .limit(1);
  return row ? row.payload : null;
}

/** Total staged conversation_posts rows — the verify/hydrate completion bound. */
export async function countConversationPosts(jobId: number): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM migration_raw_data
    WHERE job_id = ${jobId} AND entity = 'conversation_posts'
  `);
  return Number(rows(result)[0]?.n ?? 0);
}

/**
 * A stable, ordered window of staged conversation-detail payloads. Ordered by id
 * so the OFFSET cursor is deterministic across ticks/resumes.
 */
export async function readConversationPostsBatch(
  jobId: number,
  offset: number,
  limit: number,
): Promise<unknown[]> {
  const result = await db.execute(sql`
    SELECT payload
    FROM migration_raw_data
    WHERE job_id = ${jobId} AND entity = 'conversation_posts'
    ORDER BY id ASC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return rows(result).map((r) => r.payload);
}

/**
 * Finish verify: persist the review summary and gate to 'review' (the operator
 * stop). Fenced on the lease. False => lease lost; the caller must abort (a new
 * worker will recompute the summary from scratch — verify writes nothing else).
 */
export async function markMigrationReview(
  id: number,
  leaseToken: string,
  summary: MigrationSummary,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE migration_jobs
    SET status = 'review',
        summary = ${JSON.stringify(summary)}::jsonb,
        lease_token = NULL,
        leased_until = NULL,
        page_cursor = 0,
        attempts = 0,
        last_error = NULL,
        updated_at = now()
    WHERE id = ${id} AND lease_token = ${leaseToken}
    RETURNING id
  `);
  return rows(result).length > 0;
}

/**
 * Finish hydrate: gate to 'complete' and merge the ACTUAL promoted row counts
 * (recomputed by SQL from migration_job_id, never accumulated across ticks, so a
 * crash/retry can't double-count) into the existing summary. Fenced on the lease.
 */
export async function markMigrationComplete(
  id: number,
  leaseToken: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE migration_jobs
    SET status = 'complete',
        summary = COALESCE(summary, '{}'::jsonb) || jsonb_build_object(
          'hydrated', jsonb_build_object(
            'contacts', (SELECT COUNT(*)::int FROM contacts WHERE migration_job_id = ${id}),
            'conversations', (SELECT COUNT(*)::int FROM conversations WHERE migration_job_id = ${id}),
            'messages', (SELECT COUNT(*)::int FROM messages WHERE migration_job_id = ${id})
          ),
          'completedAt', to_jsonb(now())
        ),
        lease_token = NULL,
        leased_until = NULL,
        attempts = 0,
        last_error = NULL,
        updated_at = now()
    WHERE id = ${id} AND lease_token = ${leaseToken}
    RETURNING id
  `);
  return rows(result).length > 0;
}

export interface HydrateBatchStats {
  contactsCreated: number;
  contactsLinkedLive: number;
  conversationsUpserted: number;
  messagesInserted: number;
  skippedNoPhone: number;
}

function emptyHydrateStats(): HydrateBatchStats {
  return {
    contactsCreated: 0,
    contactsLinkedLive: 0,
    conversationsUpserted: 0,
    messagesInserted: 0,
    skippedNoPhone: 0,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Resolve the contact id for a conversation's phone INSIDE the hydrate txn:
 *   1. a LIVE contact (is_quarantined=false) already owns this phone -> link to
 *      it (do NOT create a quarantined dup, do NOT modify the live row — the
 *      conversation stays quarantined so nothing leaks into the live inbox);
 *   2. otherwise upsert ONE quarantined contact keyed by import_external_id
 *      `phone:<normalizedPhone>`, so customer ids that share a phone collapse to
 *      a single contact and a re-run is idempotent (ON CONFLICT DO NOTHING).
 */
async function resolveContactId(
  tx: Tx,
  tenantId: number,
  jobId: number,
  conv: NormalizedConversation,
  stats: HydrateBatchStats,
): Promise<number | null> {
  const phone = conv.phone;
  if (!phone) return null;

  const live = await tx
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.tenantId, tenantId),
        eq(contactsTable.phone, phone),
        eq(contactsTable.isQuarantined, false),
      ),
    )
    .limit(1);
  if (live[0]) {
    stats.contactsLinkedLive += 1;
    return live[0].id;
  }

  const importId = `phone:${phone}`;
  const inserted = await tx
    .insert(contactsTable)
    .values({
      tenantId,
      phone,
      name: conv.contactName,
      email: conv.contactEmail,
      tags: conv.contactTags.length ? conv.contactTags : null,
      isQuarantined: true,
      migrationJobId: jobId,
      importExternalId: importId,
      lastInteractionAt: conv.lastMessageAt ?? null,
    })
    .onConflictDoNothing({
      target: [contactsTable.tenantId, contactsTable.importExternalId],
    })
    .returning({ id: contactsTable.id });
  if (inserted[0]) {
    stats.contactsCreated += 1;
    return inserted[0].id;
  }

  const existing = await tx
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.tenantId, tenantId),
        eq(contactsTable.importExternalId, importId),
      ),
    )
    .limit(1);
  return existing[0]?.id ?? null;
}

/**
 * Promote one bounded batch of transformed conversations into QUARANTINED live
 * rows in a single advisory-locked transaction, then advance the resume cursor +
 * extend the lease ATOMICALLY with the writes. Everything is idempotent (re-run
 * upserts via the import-id unique indexes) so a crash before the cursor commits
 * just re-does the batch harmlessly.
 *   - lease fence: the txn first re-checks (lease_token, status='hydrating') FOR
 *     UPDATE; a stale worker (reclaimed lease) finds no row and writes nothing.
 *   - returns held=false the moment the lease is gone; the worker stops.
 */
export async function hydrateConversationBatch(opts: {
  tenantId: number;
  jobId: number;
  leaseToken: string;
  newCursor: number;
  leaseMs: number;
  conversations: NormalizedConversation[];
}): Promise<{ held: boolean; stats: HydrateBatchStats }> {
  const { tenantId, jobId, leaseToken, newCursor, leaseMs, conversations } = opts;
  return await db.transaction(async (tx) => {
    const lease = await tx.execute(sql`
      SELECT 1 AS ok
      FROM migration_jobs
      WHERE id = ${jobId} AND lease_token = ${leaseToken} AND status = 'hydrating'
      FOR UPDATE
    `);
    if (rows(lease).length === 0) {
      return { held: false, stats: emptyHydrateStats() };
    }
    // Serialize migration write bursts per tenant (distinct lock key from the
    // classroom push). Transaction-scoped: auto-released on commit/rollback.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}, ${MIGRATION_LOCK})`);

    const stats = emptyHydrateStats();
    for (const conv of conversations) {
      if (!conv.phone) {
        // contactPhone is NOT NULL — a conversation with no phone can't be
        // imported. Already flagged as an anomaly during verify; skip here.
        stats.skippedNoPhone += 1;
        continue;
      }
      const contactId = await resolveContactId(tx, tenantId, jobId, conv, stats);

      const upserted = await tx
        .insert(conversationsTable)
        .values({
          tenantId,
          contactId,
          contactPhone: conv.phone,
          contactName: conv.contactName,
          status: conv.status,
          tags: conv.tags.length ? conv.tags : null,
          isQuarantined: true,
          migrationJobId: jobId,
          importExternalId: conv.importExternalId,
          lastMessageAt: conv.lastMessageAt ?? null,
          ...(conv.createdAt ? { createdAt: conv.createdAt } : {}),
        })
        .onConflictDoUpdate({
          target: [conversationsTable.tenantId, conversationsTable.importExternalId],
          set: {
            contactId,
            contactName: conv.contactName,
            status: conv.status,
            tags: conv.tags.length ? conv.tags : null,
            lastMessageAt: conv.lastMessageAt ?? null,
          },
        })
        .returning({ id: conversationsTable.id });
      const conversationId = upserted[0]?.id;
      if (!conversationId) continue;
      stats.conversationsUpserted += 1;

      if (conv.messages.length) {
        await tx
          .insert(messagesTable)
          .values(
            conv.messages.map((m) => ({
              conversationId,
              direction: m.direction,
              body: m.body,
              senderName: m.senderName,
              read: true,
              isQuarantined: true,
              migrationJobId: jobId,
              importExternalId: m.importExternalId,
              status: "sent" as const,
              deliveredAt: m.deliveredAt ?? null,
              ...(m.createdAt ? { createdAt: m.createdAt } : {}),
            })),
          )
          .onConflictDoNothing({
            target: [messagesTable.conversationId, messagesTable.importExternalId],
          });
        stats.messagesInserted += conv.messages.length;
      }
    }

    await tx.execute(sql`
      UPDATE migration_jobs
      SET page_cursor = ${newCursor},
          leased_until = now() + make_interval(secs => ${leaseMs} / 1000.0),
          attempts = 0,
          last_error = NULL,
          updated_at = now()
      WHERE id = ${jobId} AND lease_token = ${leaseToken}
    `);
    return { held: true, stats };
  });
}
