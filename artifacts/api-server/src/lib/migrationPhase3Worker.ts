import { logger } from "./logger";
import {
  claimNextPhase3Job,
  readAgentsPayload,
  readConversationPostsBatch,
  countConversationPosts,
  markMigrationReview,
  markMigrationComplete,
  hydrateConversationBatch,
  heartbeatMigrationLease,
  releaseMigrationLease,
  backoffMigrationJob,
  failMigrationJob,
  type ClaimedMigrationJob,
} from "./migrationStore";
import {
  buildAgentMap,
  transformConversationDetail,
  newSummaryAccumulator,
  foldIntoSummary,
  finalizeSummary,
  type AgentMap,
} from "./migrationTransform";

// ---------------------------------------------------------------------------
// TextLine Smasher — Phase 3 worker (verify + hydrate).
//
// Drives the stages the extraction worker never touches, claiming a DISJOINT
// status set (extracted|verifying|hydrating) under the same lease fence:
//
//   VERIFY  (extracted -> verifying -> review): a single deterministic pass that
//     streams every staged conversation_posts payload, transforms it in memory,
//     and folds it into a bounded summary (the seen-phone Set lives in memory
//     ONLY). It writes NOTHING except the final summary + status='review'. A
//     crash mid-verify simply gets reclaimed and recomputed from scratch — safe
//     precisely because verify never persists partial state.
//
//   HYDRATE (review -> hydrating -> complete): the operator gate opens this in
//     routes/migrations.ts (review -> hydrating, cursor reset to 0). The worker
//     then promotes conversations into QUARANTINED live rows in bounded,
//     cursor-resumable batches. Each batch is one advisory-locked transaction
//     that (re)checks the lease, writes contacts/conversations/messages
//     idempotently, and advances the resume cursor ATOMICALLY with the writes,
//     so a crash just re-does the in-flight batch harmlessly.
//
// Every fenced mutator returns whether the lease was still held; the worker
// stops the instant it loses ownership (a new worker reclaimed the job).
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5_000;
const LEASE_MS = 60_000;
// Per-claim wall-clock budget for HYDRATE: do bounded work, persist the cursor
// inside each batch txn, then yield so the lease window stays short.
const TICK_BUDGET_MS = 8_000;
// Verify reads a wide window per round (cheap local DB reads + pure transform).
const VERIFY_BATCH = 200;
// Hydrate writes a bounded number of conversations per advisory-locked txn.
const HYDRATE_BATCH = 25;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5_000;

// One Phase-3 job in flight per process; the DB lease handles multi-instance.
let running = false;

export function startMigrationPhase3Worker(): void {
  logger.info("Migration Phase 3 worker started (poll every 5s)");
  setInterval(() => {
    runPhase3Cycle().catch((err) => {
      logger.error({ err }, "Migration Phase 3 worker cycle error");
    });
  }, POLL_INTERVAL_MS);
}

async function runPhase3Cycle(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const job = await claimNextPhase3Job(LEASE_MS);
    if (!job) return;
    if (job.status === "verifying") {
      await runVerify(job);
    } else if (job.status === "hydrating") {
      await runHydrate(job);
    } else {
      // Defensive: claim only ever sets verifying/keeps hydrating.
      logger.warn({ jobId: job.id, status: job.status }, "Phase 3 claimed unexpected status; releasing");
      await releaseMigrationLease(job.id, job.leaseToken);
    }
  } finally {
    running = false;
  }
}

/** Log + stop when a fenced write found the lease already gone. */
function leaseLost(jobId: number, action: string): void {
  logger.warn(
    { jobId, action },
    "Migration Phase 3 lease lost mid-tick (another worker reclaimed the job); aborting this tick",
  );
}

/**
 * VERIFY: stream staged conversation_posts in windows, fold into the summary,
 * heartbeat between windows, then write the summary + gate to 'review' ONCE.
 * Persists nothing partial — a crash recomputes cleanly on the next claim.
 */
async function runVerify(job: ClaimedMigrationJob): Promise<void> {
  try {
    const agentMap = buildAgentMap(await readAgentsPayload(job.id));
    const acc = newSummaryAccumulator();
    let offset = 0;
    for (;;) {
      const batch = await readConversationPostsBatch(job.id, offset, VERIFY_BATCH);
      if (batch.length === 0) break;
      for (const payload of batch) {
        foldIntoSummary(acc, transformConversationDetail(payload, agentMap));
      }
      offset += batch.length;
      // Keep the lease alive across a long verify; bail the moment it's gone.
      if (!(await heartbeatMigrationLease(job.id, job.leaseToken, LEASE_MS))) {
        leaseLost(job.id, "heartbeatMigrationLease(verify)");
        return;
      }
    }

    const summary = finalizeSummary(acc);
    if (!(await markMigrationReview(job.id, job.leaseToken, summary))) {
      leaseLost(job.id, "markMigrationReview");
      return;
    }
    logger.info(
      {
        jobId: job.id,
        conversations: summary.conversations.imported,
        messages: summary.messages.imported,
        skippedMms: summary.messages.skippedMms,
        uniquePhones: summary.contacts.uniquePhones,
        anomalyCount: summary.anomalyCount,
      },
      "Migration verify complete -> review",
    );
  } catch (err) {
    await handlePhase3Error(job, err, "verify");
  }
}

/**
 * HYDRATE: promote conversations into QUARANTINED live rows in bounded,
 * cursor-resumable batches. Each batch's writes + cursor advance commit
 * atomically (and lease-fenced) inside hydrateConversationBatch. When the cursor
 * reaches the staged total, gate to 'complete'.
 */
async function runHydrate(job: ClaimedMigrationJob): Promise<void> {
  try {
    const agentMap: AgentMap = buildAgentMap(await readAgentsPayload(job.id));
    const total = await countConversationPosts(job.id);
    let offset = job.pageCursor > 0 ? job.pageCursor : 0;
    const deadline = Date.now() + TICK_BUDGET_MS;

    while (Date.now() < deadline) {
      if (offset >= total) {
        if (!(await markMigrationComplete(job.id, job.leaseToken))) {
          leaseLost(job.id, "markMigrationComplete");
          return;
        }
        logger.info({ jobId: job.id, conversations: total }, "Migration hydrate complete");
        return;
      }

      const batch = await readConversationPostsBatch(job.id, offset, HYDRATE_BATCH);
      if (batch.length === 0) {
        // Cursor < total but nothing read (defensive) — treat as finished.
        if (!(await markMigrationComplete(job.id, job.leaseToken))) {
          leaseLost(job.id, "markMigrationComplete(empty)");
          return;
        }
        logger.info({ jobId: job.id, offset, total }, "Migration hydrate finished (short read)");
        return;
      }

      const conversations = batch.map((p) => transformConversationDetail(p, agentMap));
      const newCursor = offset + batch.length;
      const { held, stats } = await hydrateConversationBatch({
        tenantId: job.tenantId,
        jobId: job.id,
        leaseToken: job.leaseToken,
        newCursor,
        leaseMs: LEASE_MS,
        conversations,
      });
      if (!held) {
        leaseLost(job.id, "hydrateConversationBatch");
        return;
      }
      offset = newCursor;
      logger.debug({ jobId: job.id, offset, total, stats }, "Migration hydrate batch committed");
    }

    // Budget exhausted — the cursor is already durably persisted in the last
    // batch txn; just drop the lease and let the next claim resume.
    if (!(await releaseMigrationLease(job.id, job.leaseToken))) {
      leaseLost(job.id, "releaseMigrationLease(hydrate)");
    }
  } catch (err) {
    await handlePhase3Error(job, err, "hydrate");
  }
}

/**
 * Durable failure handling for Phase 3: bump the consecutive-failure counter and
 * back off (release lease + rate_limited_until), and at the cap park 'failed'.
 * Verify recomputes from scratch on retry; hydrate resumes from its cursor.
 */
async function handlePhase3Error(
  job: ClaimedMigrationJob,
  err: unknown,
  stage: "verify" | "hydrate",
): Promise<void> {
  const attempts = job.attempts + 1;
  const msg = err instanceof Error ? err.message : String(err);
  if (attempts >= MAX_ATTEMPTS) {
    if (!(await failMigrationJob(job.id, job.leaseToken, `Phase 3 ${stage} failed after ${attempts} attempts: ${msg}`))) {
      leaseLost(job.id, "failMigrationJob(phase3-cap)");
      return;
    }
    logger.error({ jobId: job.id, stage, err }, "Migration Phase 3 failed (attempt cap reached)");
    return;
  }
  const backoffMs = BASE_BACKOFF_MS * 2 ** (attempts - 1);
  if (!(await backoffMigrationJob(job.id, job.leaseToken, attempts, backoffMs, msg))) {
    leaseLost(job.id, "backoffMigrationJob(phase3)");
    return;
  }
  logger.warn({ jobId: job.id, stage, attempts, backoffMs }, "Migration Phase 3 error; will retry");
}
