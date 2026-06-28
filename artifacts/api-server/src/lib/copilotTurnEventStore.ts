import { db, copilotTurnEventsTable } from "@workspace/db";
import type { AiDraftSource } from "./aiStateStore";

/**
 * Append-only history for the Co-Pilot draft path. One row per inbound message
 * (unique tenant+inboundMessageId) so the per-turn "answered using Knowledge"
 * vs "raced to Grok" breakdown can be reported from durable history rather than
 * the latest-only `conversation_ai_states` snapshot (which is overwritten on
 * every new inbound). Mirrors `autopilotTurnEventStore` for Auto-Pilot.
 *
 * This is best-effort instrumentation: it must NEVER break the inbound draft
 * pipeline, so callers wrap it and swallow failures.
 */

export type RecordCopilotTurnEventInput = {
  tenantId: number;
  conversationId: number;
  /** The inbound messages.id this Co-Pilot turn drafted for (idempotency key). */
  inboundMessageId: number;
  inboundSid?: string | null;
  draftSource: AiDraftSource;
  /**
   * Authoritative knowledge-match signal for this turn (Classroom FTS/coverage
   * hit OR the Student's KB match). Do NOT infer from draftSource — a "student"
   * draft can be ungrounded.
   */
  grounded: boolean;
  /** Whether the guarded draft write actually staged into the composer. */
  staged: boolean;
  queryCategory?: string | null;
};

/**
 * Record one Co-Pilot draft turn. Idempotent on (tenantId, inboundMessageId): a
 * carrier webhook retry for the same inbound is a no-op. Returns true when a new
 * row was written, false when an event for this inbound already existed.
 */
export async function recordCopilotTurnEvent(
  input: RecordCopilotTurnEventInput,
): Promise<boolean> {
  const rows = await db
    .insert(copilotTurnEventsTable)
    .values({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      inboundMessageId: input.inboundMessageId,
      inboundSid: input.inboundSid ?? null,
      draftSource: input.draftSource,
      grounded: input.grounded,
      staged: input.staged,
      queryCategory: input.queryCategory ?? null,
    })
    .onConflictDoNothing({
      target: [
        copilotTurnEventsTable.tenantId,
        copilotTurnEventsTable.inboundMessageId,
      ],
    })
    .returning({ id: copilotTurnEventsTable.id });
  return rows.length > 0;
}
