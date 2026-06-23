import { db, conversationInboundAiStagesTable } from "@workspace/db";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Durable, per-conversation FIFO staging for the inbound AI pipeline.
//
// Why: the AI engagement pipeline (Student draft / Co-Pilot / Auto-Pilot gate +
// auto-send / Professor escalation) used to run inline in the webhook's
// fire-and-forget block, throttled only by a best-effort in-process Map.
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

// Smart burst-coalescing window. An inbound is held back from the worker for
// this long (available_at = received_at + window) so rapid follow-up texts to
// the SAME conversation can land first and be collapsed into ONE reply. Texts
// whose consecutive arrival gap exceeds the window are treated as separate
// turns and answered separately. Tunable without a code change via
// SAMA_AI_COALESCE_WINDOW_MS; defaults to 6s (long enough to absorb a human
// "hi / are you open? / what are prices?" burst, short enough to feel prompt).
const DEFAULT_COALESCE_WINDOW_MS = 6_000;

function resolveCoalesceWindowMs(): number {
  const raw = process.env.SAMA_AI_COALESCE_WINDOW_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_COALESCE_WINDOW_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_COALESCE_WINDOW_MS;
  return Math.floor(parsed);
}

export const COALESCE_WINDOW_MS = resolveCoalesceWindowMs();

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
  const now = new Date();
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
      receivedAt: now,
      // Hold back briefly so a rapid follow-up text can land and coalesce into
      // this turn instead of triggering a second reply (smart burst policy).
      availableAt: new Date(now.getTime() + COALESCE_WINDOW_MS),
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
  receivedAt: Date;
  attempts: number;
}

/**
 * A queued follow-up that may be coalesced into the burst anchored by the
 * currently-claimed stage. Same shape minus the claim-only `attempts`.
 */
export interface CoalescibleStage {
  id: number;
  inboundMessageId: number;
  inboundSid: string | null;
  messageBody: string;
  fromNumber: string;
  receivedAt: Date;
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
                s.inbound_sid, s.message_body, s.from_number, s.received_at,
                s.attempts
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
      receivedAt: new Date(row.received_at as string),
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
 * Gather the queued follow-ups that should coalesce into the burst anchored by
 * the just-claimed stage. Safe to read without locking: the claimed anchor is
 * already 'processing', so the partial unique index keeps every other worker
 * off this conversation entirely until we finalize.
 *
 * Burst rule: starting from the anchor, include each next-newest queued stage
 * whose arrival gap from the PREVIOUS member is within the window; stop at the
 * first gap that exceeds it (that and everything after is a later, separate
 * turn). This is what makes "rapid burst → one reply, far apart → separate"
 * smart rather than a blunt time bucket.
 */
export async function gatherCoalescibleFollowups(
  conversationId: number,
  anchorReceivedAt: Date,
): Promise<CoalescibleStage[]> {
  const rows = await db
    .select({
      id: conversationInboundAiStagesTable.id,
      inboundMessageId: conversationInboundAiStagesTable.inboundMessageId,
      inboundSid: conversationInboundAiStagesTable.inboundSid,
      messageBody: conversationInboundAiStagesTable.messageBody,
      fromNumber: conversationInboundAiStagesTable.fromNumber,
      receivedAt: conversationInboundAiStagesTable.receivedAt,
    })
    .from(conversationInboundAiStagesTable)
    .where(
      and(
        eq(conversationInboundAiStagesTable.conversationId, conversationId),
        eq(conversationInboundAiStagesTable.status, "queued"),
        gt(conversationInboundAiStagesTable.receivedAt, anchorReceivedAt),
      ),
    )
    .orderBy(
      asc(conversationInboundAiStagesTable.receivedAt),
      asc(conversationInboundAiStagesTable.id),
    );

  const burst: CoalescibleStage[] = [];
  let prev = anchorReceivedAt.getTime();
  for (const row of rows) {
    const t = row.receivedAt.getTime();
    if (t - prev > COALESCE_WINDOW_MS) break;
    burst.push(row);
    prev = t;
  }
  return burst;
}

/**
 * Finalize a coalesced burst atomically: the anchor is marked done and every
 * coalesced follow-up is marked skipped('coalesced'). One transaction so a
 * crash never leaves the burst half-finalized (which could split it and, on a
 * re-run with a different newest member, change the idempotency anchor).
 */
export async function finalizeCoalescedBurst(
  anchorId: number,
  followupIds: number[],
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    if (followupIds.length > 0) {
      await tx
        .update(conversationInboundAiStagesTable)
        .set({
          status: "skipped",
          skipReason: "coalesced",
          doneAt: now,
          updatedAt: now,
        })
        .where(inArray(conversationInboundAiStagesTable.id, followupIds));
    }
    await tx
      .update(conversationInboundAiStagesTable)
      .set({ status: "done", doneAt: now, updatedAt: now })
      .where(eq(conversationInboundAiStagesTable.id, anchorId));
  });
}

/**
 * Record a failure for a coalesced burst. The WHOLE burst is requeued (or
 * dead-lettered at the attempt cap) together with the SAME available_at so the
 * retry re-coalesces the identical set — never claiming a follow-up as a new,
 * smaller burst that would split the turn and re-anchor idempotency. The
 * anchor's attempts drives backoff/cap; follow-ups ride along.
 */
export async function failCoalescedBurst(
  anchorId: number,
  followupIds: number[],
  attempts: number,
  errMsg: string,
): Promise<void> {
  const now = new Date();
  const lastError = errMsg.slice(0, MAX_ERROR_LEN);
  const deadLetter = attempts >= MAX_ATTEMPTS;
  await db.transaction(async (tx) => {
    if (deadLetter) {
      await tx
        .update(conversationInboundAiStagesTable)
        .set({ status: "failed", lastError, doneAt: now, updatedAt: now })
        .where(eq(conversationInboundAiStagesTable.id, anchorId));
      if (followupIds.length > 0) {
        await tx
          .update(conversationInboundAiStagesTable)
          .set({ status: "failed", lastError, doneAt: now, updatedAt: now })
          .where(inArray(conversationInboundAiStagesTable.id, followupIds));
      }
      return;
    }
    const backoffMs = BASE_BACKOFF_MS * 2 ** (attempts - 1);
    const availableAt = new Date(now.getTime() + backoffMs);
    await tx
      .update(conversationInboundAiStagesTable)
      .set({ status: "queued", lastError, availableAt, updatedAt: now })
      .where(eq(conversationInboundAiStagesTable.id, anchorId));
    if (followupIds.length > 0) {
      await tx
        .update(conversationInboundAiStagesTable)
        .set({ status: "queued", availableAt, updatedAt: now })
        .where(inArray(conversationInboundAiStagesTable.id, followupIds));
    }
  });
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
