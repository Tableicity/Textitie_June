import {
  db,
  conversationAiStatesTable,
  type ConversationAiStateRow,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Single source of truth for the per-conversation AI reply state that drives the
 * inbox send-button color and the Co-Pilot draft. Exactly ONE row exists per
 * conversation (unique conversation index) and is upserted on every inbound.
 *
 * status meanings (see schema/conversationAiStates.ts):
 *   drafted        → Co-Pilot draft waiting in the composer (Yellow)
 *   auto_sent      → Auto-Pilot sent it autonomously, verbatim (Green)
 *   refused        → Auto-Pilot safety gate blocked it → human steps in (Blue + chip)
 *   failed         → Grok/send error → human steps in (Blue + chip)
 *   human_handled  → a human took the wheel for this reply (no learning)
 *   superseded     → manual mode / automation handled / replaced by a newer turn
 *   idle           → no actionable AI state
 */
export type AiStateStatus =
  | "idle"
  | "drafted"
  | "auto_sent"
  | "failed"
  | "refused"
  | "human_handled"
  | "superseded";

export type AiDraftSource = "student" | "professor";

export interface UpsertAiStateInput {
  tenantId: number;
  conversationId: number;
  status: AiStateStatus;
  draftBody?: string | null;
  draftSource?: AiDraftSource | null;
  confidence?: string | null;
  queryCategory?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  latestInboundMessageId?: number | null;
  inboundSid?: string | null;
  outboundMessageId?: number | null;
  autoSentAt?: Date | null;
}

/**
 * Upsert the conversation's AI state. Keyed on conversationId (unique), so the
 * latest inbound's disposition always overwrites the previous one.
 */
export async function upsertConversationAiState(
  input: UpsertAiStateInput,
): Promise<void> {
  const now = new Date();
  const values = {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    status: input.status,
    draftBody: input.draftBody ?? null,
    draftSource: input.draftSource ?? null,
    confidence: input.confidence ?? null,
    queryCategory: input.queryCategory ?? null,
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText ?? null,
    latestInboundMessageId: input.latestInboundMessageId ?? null,
    inboundSid: input.inboundSid ?? null,
    outboundMessageId: input.outboundMessageId ?? null,
    autoSentAt: input.autoSentAt ?? null,
    updatedAt: now,
  };
  await db
    .insert(conversationAiStatesTable)
    .values(values)
    .onConflictDoUpdate({
      target: conversationAiStatesTable.conversationId,
      set: {
        status: values.status,
        draftBody: values.draftBody,
        draftSource: values.draftSource,
        confidence: values.confidence,
        queryCategory: values.queryCategory,
        reasonCode: values.reasonCode,
        reasonText: values.reasonText,
        latestInboundMessageId: values.latestInboundMessageId,
        inboundSid: values.inboundSid,
        outboundMessageId: values.outboundMessageId,
        autoSentAt: values.autoSentAt,
        updatedAt: now,
      },
    });
}

/**
 * Mark the conversation's AI state superseded (manual mode is on, the automation
 * engine already handled the inbound, or a newer turn replaced an old draft).
 * Only touches an EXISTING row — if the AI never produced a state we leave the
 * table empty rather than create a meaningless "superseded" row.
 */
export async function supersedeConversationAiState(opts: {
  tenantId: number;
  conversationId: number;
  latestInboundMessageId?: number | null;
}): Promise<void> {
  const now = new Date();
  await db
    .update(conversationAiStatesTable)
    .set({
      status: "superseded",
      draftBody: null,
      draftSource: null,
      reasonCode: null,
      reasonText: null,
      latestInboundMessageId: opts.latestInboundMessageId ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversationAiStatesTable.tenantId, opts.tenantId),
        eq(conversationAiStatesTable.conversationId, opts.conversationId),
      ),
    );
}

// Statuses that represent a reply still AWAITING a human. When a human sends,
// these flip to human_handled (so the button leaves the Blue-handback / Yellow-
// draft state). A row already at auto_sent stays put — that reply went out
// autonomously and a later human message is a fresh turn.
const HUMAN_TAKEABLE: AiStateStatus[] = ["idle", "drafted", "refused", "failed"];

/**
 * Mark the conversation's AI state human_handled when a human sends a reply.
 * This is the UI signal that a person took the wheel for this turn. It also
 * encodes the learning guarantee: any human touch means we never learned from
 * this exchange (learning only happens on an autonomous, unedited auto-send).
 * Returns true when a row was flipped.
 */
export async function markConversationAiStateHumanHandled(opts: {
  tenantId: number;
  conversationId: number;
  humanHandledBy?: number | null;
}): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(conversationAiStatesTable)
    .set({
      status: "human_handled",
      draftBody: null,
      draftSource: null,
      reasonCode: null,
      reasonText: null,
      humanHandledBy: opts.humanHandledBy ?? null,
      humanHandledAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversationAiStatesTable.tenantId, opts.tenantId),
        eq(conversationAiStatesTable.conversationId, opts.conversationId),
        inArray(conversationAiStatesTable.status, HUMAN_TAKEABLE),
      ),
    )
    .returning({ id: conversationAiStatesTable.id });
  return updated.length > 0;
}

/** Load the AI state for a single conversation (null when none exists). */
export async function getConversationAiState(
  tenantId: number,
  conversationId: number,
): Promise<ConversationAiStateRow | null> {
  const rows = await db
    .select()
    .from(conversationAiStatesTable)
    .where(
      and(
        eq(conversationAiStatesTable.tenantId, tenantId),
        eq(conversationAiStatesTable.conversationId, conversationId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Bulk-load AI states for a set of conversations, keyed by conversationId. */
export async function getConversationAiStates(
  tenantId: number,
  conversationIds: number[],
): Promise<Map<number, ConversationAiStateRow>> {
  const map = new Map<number, ConversationAiStateRow>();
  if (conversationIds.length === 0) return map;
  const rows = await db
    .select()
    .from(conversationAiStatesTable)
    .where(
      and(
        eq(conversationAiStatesTable.tenantId, tenantId),
        inArray(conversationAiStatesTable.conversationId, conversationIds),
      ),
    );
  for (const r of rows) map.set(r.conversationId, r);
  return map;
}
