import { and, desc, eq } from "drizzle-orm";
import { db, autopilotTurnEventsTable } from "@workspace/db";
import {
  computeAutoPilotFallbackCounts,
  type AutopilotTurnOutcome,
  type AutoPilotFallbackCounts,
} from "./engagementPolicy";

/**
 * Append-only history for the Auto-Pilot fail-open path. One row per inbound
 * message (unique tenant+inboundMessageId), so the fallback circuit breaker can
 * be counted from durable history rather than fragile in-memory state. This is
 * the storage layer; the counting RULES live in the pure
 * `computeAutoPilotFallbackCounts` so they stay unit-testable without a DB.
 */

export type RecordAutopilotTurnEventInput = {
  tenantId: number;
  conversationId: number;
  /** The inbound messages.id this Auto-Pilot turn resolved (idempotency key). */
  inboundMessageId: number;
  inboundSid?: string | null;
  outcome: AutopilotTurnOutcome;
  replyKind?: string | null;
  outboundMessageId?: number | null;
  reasonCode?: string | null;
};

/**
 * Record one Auto-Pilot turn. Idempotent on (tenantId, inboundMessageId): a
 * carrier webhook retry for the same inbound is a no-op, so the breaker can
 * never be double-counted. Returns true when a new row was written, false when
 * an event for this inbound already existed.
 */
export async function recordAutopilotTurnEvent(
  input: RecordAutopilotTurnEventInput,
): Promise<boolean> {
  const rows = await db
    .insert(autopilotTurnEventsTable)
    .values({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      inboundMessageId: input.inboundMessageId,
      inboundSid: input.inboundSid ?? null,
      outcome: input.outcome,
      replyKind: input.replyKind ?? null,
      outboundMessageId: input.outboundMessageId ?? null,
      reasonCode: input.reasonCode ?? null,
    })
    .onConflictDoNothing({
      target: [
        autopilotTurnEventsTable.tenantId,
        autopilotTurnEventsTable.inboundMessageId,
      ],
    })
    .returning({ id: autopilotTurnEventsTable.id });
  return rows.length > 0;
}

// How many recent turns to scan when computing the breaker tallies. A trailing
// run / 2-min burst is bounded well under this; a higher count just bounds the
// scan if a conversation never gets an answer/stepdown boundary.
const FALLBACK_HISTORY_LIMIT = 50;

/**
 * Compute the breaker tallies (consecutive run + rolling-window count) for a
 * conversation from its recent Auto-Pilot turn history. Returns counts for the
 * turns BEFORE `now`; the caller adds the current turn when deciding.
 */
export async function getAutopilotFallbackCounts(
  tenantId: number,
  conversationId: number,
  now: Date = new Date(),
): Promise<AutoPilotFallbackCounts> {
  const rows = await db
    .select({
      outcome: autopilotTurnEventsTable.outcome,
      createdAt: autopilotTurnEventsTable.createdAt,
    })
    .from(autopilotTurnEventsTable)
    .where(
      and(
        eq(autopilotTurnEventsTable.tenantId, tenantId),
        eq(autopilotTurnEventsTable.conversationId, conversationId),
      ),
    )
    // Newest first, with the serial id as a deterministic tiebreak so same-
    // millisecond inserts still order correctly.
    .orderBy(
      desc(autopilotTurnEventsTable.createdAt),
      desc(autopilotTurnEventsTable.id),
    )
    .limit(FALLBACK_HISTORY_LIMIT);
  return computeAutoPilotFallbackCounts(
    rows.map((r) => ({
      outcome: r.outcome,
      // Normalize regardless of the driver's timestamp mode (Date or string).
      createdAt: new Date(r.createdAt as unknown as string),
    })),
    now,
  );
}
