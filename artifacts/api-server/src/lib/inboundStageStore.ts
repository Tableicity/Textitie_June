import { db, conversationInboundAiStagesTable } from "@workspace/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Durable, per-conversation FIFO staging for the inbound AI pipeline.
//
// Why: the AI engagement pipeline (Student draft / Co-Pilot / Auto-Pilot gate +
// auto-send / Professor escalation) used to run inline in the webhook's
// fire-and-forget block, throttled by an in-process Map (claimEscalationSlot).
// Two rapid inbounds to the SAME conversation could interleave their pipelines
// (racing drafts, double escalations) and nothing survived a restart. This
// store backs a real table so:
//   - inbounds to one conversation are processed strictly in arrival order
//     (one in flight per conversation), while different conversations run in
//     parallel,
//   - work survives restarts and is safe across multiple deployed instances
//     (DB-level claiming, not in-memory state),
//   - a crashed worker's claim is reclaimed after a visibility timeout.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2_000;
const MAX_ERROR_LEN = 2_000;

export interface EnqueueInboundAiStageInput {
  tenantId: number;
  conversationId: number;
  inboundMessageId: number;
  inboundSid: string | null;
  messageBody: string;
  fromNumber: string;
}

/**
 * Enqueue an inbound for AI processing. Idempotent: the unique index on
 * inbound_message_id means a carrier webhook retry (same inbound message) is a
 * no-op. Returns true only when a NEW stage row was inserted (caller should
 * poke the worker), false when one already existed.
 */
export async function enqueueInboundAiStage(
  input: EnqueueInboundAiStageInput,
): Promise<boolean> {
  const written = await db
    .insert(conversationInboundAiStagesTable)
    .values({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      inboundMessageId: input.inboundMessageId,
      inboundSid: input.inboundSid,
      messageBody: input.messageBody,
      fromNumber: input.fromNumber,
      status: "queued",
    })
    .onConflictDoNothing({
      target: conversationInboundAiStagesTable.inboundMessageId,
    })
    .returning({ id: conversationInboundAiStagesTable.id });
  return written.length > 0;
}

export interface ClaimedInboundAiStage {
  id: number;
  tenantId: number;
  conversationId: number;
  inboundMessageId: number;
  inboundSid: string | null;
  messageBody: string;
  fromNumber: string;
  attempts: number;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "23505"
  );
}

/**
 * Atomically claim the oldest eligible queued stage whose conversation has NO
 * row already processing — enforcing one-in-flight-per-conversation FIFO while
 * letting distinct conversations be claimed in parallel.
 *
 * The whole claim is a single UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP
 * LOCKED LIMIT 1): SKIP LOCKED keeps two workers off the same row, and the
 * NOT EXISTS keeps us off a conversation that's already in flight. The partial
 * unique index (one processing row per conversation) is the final backstop —
 * if two workers race two DIFFERENT queued rows of the SAME conversation, the
 * second UPDATE to 'processing' raises a unique violation, which we treat as
 * "nothing claimed this round" (that row stays queued for the next poll).
 *
 * attempts is incremented at claim time so failure backoff can read it.
 */
export async function claimNextInboundAiStage(): Promise<ClaimedInboundAiStage | null> {
  try {
    const result = await db.execute(sql`
      UPDATE conversation_inbound_ai_stages AS s
      SET status = 'processing',
          processing_started_at = now(),
          attempts = s.attempts + 1,
          updated_at = now()
      WHERE s.id = (
        SELECT cand.id
        FROM conversation_inbound_ai_stages AS cand
        WHERE cand.status = 'queued'
          AND cand.available_at <= now()
          AND NOT EXISTS (
            SELECT 1
            FROM conversation_inbound_ai_stages AS busy
            WHERE busy.conversation_id = cand.conversation_id
              AND busy.status = 'processing'
          )
        ORDER BY cand.received_at ASC, cand.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING s.id, s.tenant_id, s.conversation_id, s.inbound_message_id,
                s.inbound_sid, s.message_body, s.from_number, s.attempts
    `);
    const row = (result.rows as Record<string, unknown>[])[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      tenantId: Number(row.tenant_id),
      conversationId: Number(row.conversation_id),
      inboundMessageId: Number(row.inbound_message_id),
      inboundSid: (row.inbound_sid as string | null) ?? null,
      messageBody: String(row.message_body),
      fromNumber: String(row.from_number),
      attempts: Number(row.attempts),
    };
  } catch (e) {
    // Lost the partial-unique race for a conversation already in flight — the
    // row stays queued for the next poll. Any other error is real.
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

/** Mark a stage finished successfully. */
export async function completeInboundAiStage(id: number): Promise<void> {
  const now = new Date();
  await db
    .update(conversationInboundAiStagesTable)
    .set({ status: "done", doneAt: now, updatedAt: now })
    .where(eq(conversationInboundAiStagesTable.id, id));
}

/** Mark a stage intentionally not processed (manual mode, coalesced, etc.). */
export async function skipInboundAiStage(
  id: number,
  reason: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(conversationInboundAiStagesTable)
    .set({
      status: "skipped",
      skipReason: reason.slice(0, MAX_ERROR_LEN),
      doneAt: now,
      updatedAt: now,
    })
    .where(eq(conversationInboundAiStagesTable.id, id));
}

/**
 * Record a processing failure. Below the attempt cap the row is requeued with
 * exponential backoff (so a transient error retries); at the cap it is parked
 * as 'failed'. attempts here is the value READ at claim time (already
 * incremented), so it reflects the try that just failed.
 */
export async function failInboundAiStage(
  id: number,
  attempts: number,
  errMsg: string,
): Promise<void> {
  const now = new Date();
  const lastError = errMsg.slice(0, MAX_ERROR_LEN);
  if (attempts >= MAX_ATTEMPTS) {
    await db
      .update(conversationInboundAiStagesTable)
      .set({ status: "failed", lastError, doneAt: now, updatedAt: now })
      .where(eq(conversationInboundAiStagesTable.id, id));
    return;
  }
  const backoffMs = BASE_BACKOFF_MS * 2 ** (attempts - 1);
  await db
    .update(conversationInboundAiStagesTable)
    .set({
      status: "queued",
      lastError,
      availableAt: new Date(now.getTime() + backoffMs),
      updatedAt: now,
    })
    .where(eq(conversationInboundAiStagesTable.id, id));
}

/**
 * Reclaim stages stuck in 'processing' past the visibility timeout (the worker
 * crashed mid-flight). They go back to 'queued' for a fresh attempt — the
 * inbound AI pipeline's own auto-send idempotency (ai_auto_replies) makes a
 * re-run safe. Returns how many were reclaimed.
 */
export async function requeueStaleProcessingStages(
  visibilityMs: number,
): Promise<number> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - visibilityMs);
  const requeued = await db
    .update(conversationInboundAiStagesTable)
    .set({
      status: "queued",
      availableAt: now,
      lastError: "reclaimed after visibility timeout",
      updatedAt: now,
    })
    .where(
      and(
        eq(conversationInboundAiStagesTable.status, "processing"),
        lt(conversationInboundAiStagesTable.processingStartedAt, cutoff),
      ),
    )
    .returning({ id: conversationInboundAiStagesTable.id });
  if (requeued.length > 0) {
    logger.warn(
      { count: requeued.length },
      "Reclaimed stale inbound AI stages (visibility timeout)",
    );
  }
  return requeued.length;
}
