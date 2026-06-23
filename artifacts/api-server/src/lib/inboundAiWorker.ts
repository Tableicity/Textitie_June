import { db, tenantsTable, conversationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  claimNextInboundAiStage,
  gatherCoalescibleFollowups,
  finalizeCoalescedBurst,
  failCoalescedBurst,
  skipInboundAiStage,
  requeueStaleProcessingStages,
  type ClaimedInboundAiStage,
} from "./inboundStageStore";
import { runInboundAiPipeline } from "./inboundAiPipeline";

// ---------------------------------------------------------------------------
// Durable FIFO worker for the inbound AI pipeline.
//
// It drains conversation_inbound_ai_stages: at most one inbound per conversation
// is in flight at a time (the claim excludes conversations already processing),
// while distinct conversations run concurrently. It is poked immediately after
// an enqueue for low latency and also polls on an interval as a safety net /
// for stages requeued after a crash. Correct across multiple deployed instances
// because all claiming is done at the DB level (FOR UPDATE SKIP LOCKED + a
// partial unique index), not via in-process state.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 1_500;
const VISIBILITY_TIMEOUT_MS = 2 * 60_000;
// Max distinct conversations processed concurrently per drain pass.
const MAX_BATCH = 8;

let cycleRunning = false;
let pokePending = false;
let started = false;

async function processOne(stage: ClaimedInboundAiStage): Promise<void> {
  // followupIds is declared out here so a failure at ANY point below (including
  // the gather itself) fails the WHOLE burst together — never leaving a
  // follow-up behind to be re-claimed as a separate, re-anchored turn.
  let followupIds: number[] = [];
  try {
    // Re-read the tenant + conversation FRESH so a mode flip or deletion between
    // enqueue and processing is honored (the pipeline resolves the live
    // effective mode from this tenant row + the per-conversation override).
    const tenantRows = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, stage.tenantId))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant) {
      await skipInboundAiStage(stage.id, "tenant_not_found");
      return;
    }
    const convRows = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, stage.conversationId))
      .limit(1);
    if (convRows.length === 0) {
      await skipInboundAiStage(stage.id, "conversation_not_found");
      return;
    }

    // Smart coalescing: pull the contiguous burst of follow-up texts that
    // landed within the window and answer them as ONE turn. The anchor holds
    // the per-conversation processing lock, so this read can't race a claim.
    const followups = await gatherCoalescibleFollowups(
      stage.conversationId,
      stage.receivedAt,
    );
    followupIds = followups.map((f) => f.id);

    // Active-turn authority: the reply, the AI-state/composer turn, AND the
    // auto-send idempotency key all anchor on the NEWEST inbound in the burst
    // (last-write-wins). The query the model answers is every burst message in
    // arrival order so a "hi / are you open? / prices?" burst gets one coherent
    // reply. The combined text stays QUERY-ONLY (never persisted as truth).
    const newest =
      followups.length > 0 ? followups[followups.length - 1] : stage;
    const combinedBody = [stage.messageBody, ...followups.map((f) => f.messageBody)]
      .map((b) => b.trim())
      .filter((b) => b.length > 0)
      .join("\n");

    await runInboundAiPipeline({
      tenant,
      tenantSlug: tenant.slug,
      conversationId: stage.conversationId,
      inboundMessageId: newest.inboundMessageId,
      inboundSid: newest.inboundSid,
      messageBody: combinedBody.length > 0 ? combinedBody : stage.messageBody,
      fromNumber: newest.fromNumber,
      automationHandled: false,
    });
    await finalizeCoalescedBurst(stage.id, followupIds);
    if (followupIds.length > 0) {
      logger.info(
        {
          conversationId: stage.conversationId,
          coalesced: followupIds.length + 1,
          anchorMessageId: newest.inboundMessageId,
        },
        "SAMA AI: coalesced inbound burst into one reply",
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: msg, stageId: stage.id, conversationId: stage.conversationId },
      "Inbound AI stage processing failed; backing off",
    );
    await failCoalescedBurst(stage.id, followupIds, stage.attempts, msg);
  }
}

/**
 * Claim up to MAX_BATCH distinct-conversation stages and process them
 * concurrently. Each successive claim excludes conversations already in flight,
 * so the batch is always distinct conversations — never two inbounds of the
 * same conversation at once. Returns how many were claimed.
 */
async function drainBatch(): Promise<number> {
  const claimed: ClaimedInboundAiStage[] = [];
  for (let i = 0; i < MAX_BATCH; i++) {
    const row = await claimNextInboundAiStage();
    if (!row) break;
    claimed.push(row);
  }
  if (claimed.length === 0) return 0;
  // processOne owns its own success/failure finalization (whole-burst). This
  // catch is only a last resort if even failCoalescedBurst threw — the stage
  // stays 'processing' and is reclaimed by the visibility timeout.
  await Promise.allSettled(
    claimed.map(async (stage) => {
      try {
        await processOne(stage);
      } catch (err) {
        logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            stageId: stage.id,
            conversationId: stage.conversationId,
          },
          "Inbound AI stage handler crashed after failure handling",
        );
      }
    }),
  );
  return claimed.length;
}

async function runCycle(): Promise<void> {
  // Single in-flight cycle per process; a poke that lands while busy is folded
  // into one follow-up cycle so we never stack overlapping drains.
  if (cycleRunning) {
    pokePending = true;
    return;
  }
  cycleRunning = true;
  try {
    await requeueStaleProcessingStages(VISIBILITY_TIMEOUT_MS).catch((e) =>
      logger.warn({ err: e }, "Requeue stale inbound AI stages failed"),
    );
    // Drain until empty so an enqueue+poke is processed promptly. Each pass
    // completes its batch before the next claim, so a conversation's next
    // inbound is only picked up after the current one finishes (FIFO).
    let processed = 0;
    do {
      processed = await drainBatch();
    } while (processed > 0);
  } finally {
    cycleRunning = false;
    if (pokePending) {
      pokePending = false;
      void runCycle();
    }
  }
}

/** Nudge the worker to drain now (called right after an enqueue). */
export function pokeInboundAiWorker(): void {
  void runCycle().catch((err) =>
    logger.error({ err }, "Inbound AI worker poke failed"),
  );
}

/** Start the polling loop. Idempotent. Call once at server boot. */
export function startInboundAiWorker(): void {
  if (started) return;
  started = true;
  logger.info("Inbound AI worker started (poll every 1.5s + poke)");
  setInterval(() => {
    runCycle().catch((err) =>
      logger.error({ err }, "Inbound AI worker cycle error"),
    );
  }, POLL_INTERVAL_MS);
}
