import { logger } from "./logger";
import { decryptToken } from "./migrationCrypto";
import {
  claimNextMigrationJob,
  saveExtractionProgress,
  stageRawData,
  isRawStaged,
  getStagedPage,
  getMaxStagedPage,
  markMigrationExtracted,
  rateLimitMigrationJob,
  releaseMigrationLease,
  backoffMigrationJob,
  failMigrationJob,
  heartbeatMigrationLease,
  type ClaimedMigrationJob,
} from "./migrationStore";
import {
  fetchListPage,
  fetchConversationDetail,
  extractConversationIds,
  TextlineRateLimitedError,
  TextlineAuthError,
  TextlineError,
} from "./textlineClient";

// ---------------------------------------------------------------------------
// TextLine Smasher — durable extraction worker (Phase 2).
//
// Drives a claimed migration through EXTRACTION ONLY: pending -> extracting ->
// extracted. It never claims the human review gate, the Phase 3 hydrate state,
// or any terminal job (the claim query restricts to pending|extracting).
//
// Entities are pulled in a fixed order so the later (Phase 3) verify pass has
// the agent/group role maps before it threads conversations:
//   agents -> groups -> conversations -> conversation_posts
// Flat lists page by page_cursor; conversation_posts is diff/idempotency-driven
// (one staged conversations page at a time; per-conversation detail keyed by
// `conversation_posts:<id>`, skipped if already staged so a resume never
// re-hits the API).
//
// `counts` is NEVER tracked in memory: every fenced write recomputes it from the
// rows actually staged, so a crash mid-tick can never under/over-report it.
// Every fenced mutator returns whether the lease was still held; the worker
// stops the moment it loses ownership (a new worker has reclaimed the job).
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5_000;
// Lease TTL must comfortably exceed the per-request timeout (20s) plus pacing so
// a healthy in-flight page can't let the lease lapse and get reclaimed.
const LEASE_MS = 60_000;
// Per-claim wall-clock budget: do bounded work, persist the cursor, then yield
// so the lease window stays short and other jobs/instances get a turn.
const TICK_BUDGET_MS = 8_000;
// Infinite-pagination guard for unknown payload shapes.
const MAX_PAGES_PER_ENTITY = 100_000;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5_000;

const ENTITY_ORDER = [
  "agents",
  "groups",
  "conversations",
  "conversation_posts",
] as const;
type Entity = (typeof ENTITY_ORDER)[number];

// Auxiliary lists: a 404 here means TextLine doesn't expose that entity for this
// account — treat as "no data" and move on rather than failing the whole import.
const AUXILIARY_ENTITIES = new Set<Entity>(["agents", "groups"]);

// One migration in flight per process; DB lease handles multi-instance/crash.
let running = false;

export function startMigrationWorker(): void {
  logger.info("Migration worker started (poll every 5s)");
  setInterval(() => {
    runMigrationCycle().catch((err) => {
      logger.error({ err }, "Migration worker cycle error");
    });
  }, POLL_INTERVAL_MS);
}

async function runMigrationCycle(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const job = await claimNextMigrationJob(LEASE_MS);
    if (!job) return;
    await processClaimedJob(job);
  } finally {
    running = false;
  }
}

function isEntity(value: string | null): value is Entity {
  return value != null && (ENTITY_ORDER as readonly string[]).includes(value);
}

/** Log + stop when a fenced terminal/progress write found the lease already gone. */
function leaseLost(jobId: number, action: string): void {
  logger.warn(
    { jobId, action },
    "Migration lease lost mid-tick (another worker reclaimed the job); aborting this tick",
  );
}

/** Release the lease and surface the (benign) case where it was already gone. */
async function tryRelease(job: ClaimedMigrationJob): Promise<void> {
  if (!(await releaseMigrationLease(job.id, job.leaseToken))) {
    leaseLost(job.id, "releaseMigrationLease");
  }
}

/**
 * Drive one claimed job for up to TICK_BUDGET_MS, then yield. Persists the
 * cursor after every page so a crash/yield resumes exactly where it left off.
 */
async function processClaimedJob(job: ClaimedMigrationJob): Promise<void> {
  let token: string;
  try {
    if (!job.accessTokenEnc) throw new Error("no token on record");
    token = decryptToken(job.accessTokenEnc);
  } catch {
    await failMigrationJob(
      job.id,
      job.leaseToken,
      "Access token is missing or unreadable — restart the migration with a fresh token.",
    );
    logger.error({ jobId: job.id }, "Migration token unavailable -> job failed");
    return;
  }

  let entity: Entity = isEntity(job.currentEntity)
    ? job.currentEntity
    : ENTITY_ORDER[0];
  let page = job.pageCursor > 0 ? job.pageCursor : 1;
  const deadline = Date.now() + TICK_BUDGET_MS;

  try {
    while (Date.now() < deadline) {
      if (entity === "conversation_posts") {
        const outcome = await runPostsStep(job, token, page, deadline);
        if (outcome.failed) return; // job already parked 'failed' inside
        if (outcome.done) {
          await finishExtraction(job);
          return;
        }
        if (outcome.yielded) return; // progress saved + lease released inside
        page = outcome.nextPage;
        continue;
      }

      // Flat list entity (agents | groups | conversations).
      let result;
      try {
        result = await fetchListPage(entity, token, page);
      } catch (err) {
        if (
          err instanceof TextlineError &&
          err.status === 404 &&
          AUXILIARY_ENTITIES.has(entity)
        ) {
          logger.warn(
            { jobId: job.id, entity },
            "Auxiliary entity not available (404) — skipping",
          );
          const next = nextEntity(entity);
          if (!next) {
            await finishExtraction(job);
            return;
          }
          entity = next;
          page = 1;
          if (!(await saveProgress(job, entity, page))) return;
          continue;
        }
        throw err;
      }

      const staged = await stageRawData({
        jobId: job.id,
        tenantId: job.tenantId,
        leaseToken: job.leaseToken,
        entity,
        page,
        recordKey: `${entity}:p${page}`,
        payload: result.payload,
        recordCount: result.records.length,
      });
      if (!staged.held) {
        leaseLost(job.id, "stageRawData");
        return;
      }

      if (result.hasMore && page < MAX_PAGES_PER_ENTITY) {
        page += 1;
        if (!(await saveProgress(job, entity, page))) return;
      } else {
        const next = nextEntity(entity);
        if (!next) {
          await finishExtraction(job);
          return;
        }
        entity = next;
        page = 1;
        if (!(await saveProgress(job, entity, page))) return;
      }
    }

    // Budget exhausted — cursor already persisted each step; just yield.
    await tryRelease(job);
  } catch (err) {
    await handleExtractionError(job, err);
  }
}

/** Persist cursor + recomputed counts under the fence; log + signal on lease loss. */
async function saveProgress(
  job: ClaimedMigrationJob,
  entity: Entity,
  page: number,
): Promise<boolean> {
  const held = await saveExtractionProgress({
    id: job.id,
    leaseToken: job.leaseToken,
    currentEntity: entity,
    pageCursor: page,
    leaseMs: LEASE_MS,
  });
  if (!held) leaseLost(job.id, "saveExtractionProgress");
  return held;
}

/** Mark the job 'extracted' under the fence and log the final counts. */
async function finishExtraction(job: ClaimedMigrationJob): Promise<void> {
  const { held, counts } = await markMigrationExtracted(job.id, job.leaseToken);
  if (!held) {
    leaseLost(job.id, "markMigrationExtracted");
    return;
  }
  logger.info({ jobId: job.id, counts }, "Migration extraction complete");
}

interface PostsOutcome {
  /** All conversation pages processed — extraction is finished. */
  done: boolean;
  /** Budget hit (or lease lost) mid-page; the tick must stop. */
  yielded: boolean;
  /** A deterministic data-shape anomaly parked the job 'failed'; stop. */
  failed: boolean;
  /** Next conversations page to process (when neither done nor yielded). */
  nextPage: number;
}

/**
 * Process one conversations page worth of post-detail pulls. Each conversation's
 * detail is staged under `conversation_posts:<id>`; already-staged ids are
 * skipped WITHOUT an API call, so a resume costs only cheap existence checks.
 */
async function runPostsStep(
  job: ClaimedMigrationJob,
  token: string,
  page: number,
  deadline: number,
): Promise<PostsOutcome> {
  const maxConvPage = await getMaxStagedPage(job.id, "conversations");
  if (maxConvPage === 0 || page > maxConvPage) {
    return { done: true, yielded: false, failed: false, nextPage: page };
  }

  const staged = await getStagedPage(job.id, "conversations", page);
  // The page came from getMaxStagedPage, so it should exist; if it somehow
  // doesn't, there is nothing to expand here — advance rather than spin.
  if (!staged) {
    const nextPage = page + 1;
    const held = await saveProgress(job, "conversation_posts", nextPage);
    return { done: false, yielded: !held, failed: false, nextPage };
  }

  const convIds = extractConversationIds(staged.payload);

  // Anomaly guard: a non-empty conversations page from which we cannot extract a
  // single id means messages would be silently dropped. Fail loudly for operator
  // review instead of marking the migration 'extracted' with a data gap.
  if (staged.recordCount > 0 && convIds.length === 0) {
    const msg = `Conversations page ${page} has ${staged.recordCount} record(s) but no extractable conversation ids — the TextLine response shape likely differs from the assumed contract. Aborting so messages are not silently dropped; adjust textlineClient id extraction and restart.`;
    const held = await failMigrationJob(job.id, job.leaseToken, msg);
    if (!held) leaseLost(job.id, "failMigrationJob(posts-anomaly)");
    logger.error(
      { jobId: job.id, page, recordCount: staged.recordCount },
      "Posts extraction anomaly: conversations page has records but no ids -> job failed",
    );
    return { done: false, yielded: false, failed: true, nextPage: page };
  }

  for (const cid of convIds) {
    if (Date.now() >= deadline) {
      // Save at the CURRENT page; resume re-scans it and skips staged ids.
      const held = await saveProgress(job, "conversation_posts", page);
      if (held) await tryRelease(job);
      return { done: false, yielded: true, failed: false, nextPage: page };
    }

    const recordKey = `conversation_posts:${cid}`;
    if (await isRawStaged(job.id, recordKey)) continue;

    const detail = await fetchConversationDetail(token, cid);
    const staged = await stageRawData({
      jobId: job.id,
      tenantId: job.tenantId,
      leaseToken: job.leaseToken,
      entity: "conversation_posts",
      page,
      recordKey,
      payload: detail.payload,
      recordCount: detail.postCount,
    });
    if (!staged.held) {
      leaseLost(job.id, "stageRawData");
      return { done: false, yielded: true, failed: false, nextPage: page };
    }
    if (!(await heartbeatMigrationLease(job.id, job.leaseToken, LEASE_MS))) {
      leaseLost(job.id, "heartbeatMigrationLease");
      return { done: false, yielded: true, failed: false, nextPage: page };
    }
  }

  // Finished this conversations page — advance and persist.
  const nextPage = page + 1;
  const held = await saveProgress(job, "conversation_posts", nextPage);
  if (!held) return { done: false, yielded: true, failed: false, nextPage };
  return { done: false, yielded: false, failed: false, nextPage };
}

function nextEntity(entity: Entity): Entity | null {
  const idx = ENTITY_ORDER.indexOf(entity);
  return ENTITY_ORDER[idx + 1] ?? null;
}

/**
 * Map an extraction error to a durable outcome:
 *   - 429            -> park until Retry-After (not a failure attempt).
 *   - 401/403        -> terminal auth failure, token cleared.
 *   - transient/other -> bump consecutive-failure counter, back off, and at the
 *     cap park 'failed'. Unexpected (non-TextLine) errors are also re-thrown for
 *     visibility after being recorded.
 */
async function handleExtractionError(
  job: ClaimedMigrationJob,
  err: unknown,
): Promise<void> {
  if (err instanceof TextlineRateLimitedError) {
    if (!(await rateLimitMigrationJob(job.id, job.leaseToken, err.retryAfterMs))) {
      leaseLost(job.id, "rateLimitMigrationJob");
      return;
    }
    logger.warn(
      { jobId: job.id, retryMs: err.retryAfterMs },
      "Migration rate-limited; backing off",
    );
    return;
  }
  if (err instanceof TextlineAuthError) {
    if (
      !(await failMigrationJob(
        job.id,
        job.leaseToken,
        "TextLine rejected the access token — restart the migration with a valid token.",
      ))
    ) {
      leaseLost(job.id, "failMigrationJob(auth)");
      return;
    }
    logger.warn({ jobId: job.id }, "Migration auth failed -> job failed");
    return;
  }

  const attempts = job.attempts + 1;
  const msg = err instanceof Error ? err.message : String(err);
  if (attempts >= MAX_ATTEMPTS) {
    if (
      !(await failMigrationJob(
        job.id,
        job.leaseToken,
        `Extraction failed after ${attempts} attempts: ${msg}`,
      ))
    ) {
      leaseLost(job.id, "failMigrationJob(cap)");
      return;
    }
    logger.error({ jobId: job.id, err }, "Migration failed (attempt cap reached)");
    return;
  }

  const backoffMs = BASE_BACKOFF_MS * 2 ** (attempts - 1);
  if (!(await backoffMigrationJob(job.id, job.leaseToken, attempts, backoffMs, msg))) {
    leaseLost(job.id, "backoffMigrationJob");
    return;
  }
  logger.warn(
    { jobId: job.id, attempts, backoffMs },
    "Migration extraction error; will retry",
  );

  // Surface programmer/unexpected errors; expected TextLine transport errors are
  // already handled durably above.
  if (!(err instanceof TextlineError)) throw err;
}
