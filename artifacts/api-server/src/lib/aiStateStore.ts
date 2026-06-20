import {
  db,
  conversationAiStatesTable,
  messagesTable,
  type ConversationAiStateRow,
} from "@workspace/db";
import { and, eq, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

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
 * Finalize a Co-Pilot draft that a STREAMING Professor escalation already staged
 * early (reply text surfaced before the slow fact-reasoning finished). This fills
 * in the metadata the early stage couldn't know yet (e.g. confidence) WITHOUT
 * clobbering a row that moved on while the Professor kept streaming: it updates
 * ONLY when the row still belongs to the SAME inbound turn
 * (latestInboundMessageId match) AND a human has not taken the wheel
 * (status != human_handled). A newer inbound turn or a human send is left intact.
 * A no-op (zero rows) is the correct, safe outcome in those cases.
 */
export async function finalizeCopilotDraftForInbound(opts: {
  tenantId: number;
  conversationId: number;
  latestInboundMessageId: number;
  draftBody: string | null;
  draftSource?: AiDraftSource | null;
  confidence?: string | null;
  queryCategory?: string | null;
  inboundSid?: string | null;
}): Promise<void> {
  const now = new Date();
  await db
    .update(conversationAiStatesTable)
    .set({
      status: "drafted",
      draftBody: opts.draftBody,
      draftSource: opts.draftSource ?? null,
      confidence: opts.confidence ?? null,
      queryCategory: opts.queryCategory ?? null,
      inboundSid: opts.inboundSid ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversationAiStatesTable.tenantId, opts.tenantId),
        eq(conversationAiStatesTable.conversationId, opts.conversationId),
        eq(
          conversationAiStatesTable.latestInboundMessageId,
          opts.latestInboundMessageId,
        ),
        ne(conversationAiStatesTable.status, "human_handled"),
      ),
    );
}

/**
 * Stage a Co-Pilot draft for the CURRENT inbound turn, guarded against
 * concurrency. Used for BOTH the early streaming write (the customer reply
 * surfaced before the Professor's fact-reasoning finished) and the non-streaming
 * Co-Pilot write. Unlike {@link upsertConversationAiState} (unconditional
 * last-write-wins), the ON CONFLICT update is fenced so a late-firing async
 * write can never clobber:
 *   - a NEWER inbound turn (existing.latestInboundMessageId > this inbound), or
 *   - a human takeover of THIS (or a newer) turn (status human_handled stamped
 *     at >= this inbound — see markConversationAiStateHumanHandled, which stamps
 *     the turn it handled).
 * A genuinely older-turn row (smaller/NULL latestInboundMessageId), including a
 * stale prior-turn human_handled, is still overwritten — there is no
 * inbound-start reset in the Co-Pilot path, so a fresh turn must be able to
 * replace last turn's disposition.
 *
 * Returns true when a row was inserted or updated, false when the guard left an
 * existing row intact (the correct, safe no-op). NOTE: a brand-new conversation
 * with no AI-state row yet always INSERTs; if a human raced a reply in before
 * any row existed (markConversationAiStateHumanHandled had nothing to flip) the
 * early draft can still appear — a narrow, Co-Pilot-only edge (no auto-send) the
 * next inbound supersedes.
 */
export async function stageCopilotDraftForInbound(opts: {
  tenantId: number;
  conversationId: number;
  latestInboundMessageId: number;
  draftBody: string | null;
  draftSource?: AiDraftSource | null;
  confidence?: string | null;
  queryCategory?: string | null;
  inboundSid?: string | null;
}): Promise<boolean> {
  const now = new Date();
  const t = conversationAiStatesTable;
  const c = opts.latestInboundMessageId;
  const fields = {
    status: "drafted" as const,
    draftBody: opts.draftBody,
    draftSource: opts.draftSource ?? null,
    confidence: opts.confidence ?? null,
    queryCategory: opts.queryCategory ?? null,
    reasonCode: null,
    reasonText: null,
    latestInboundMessageId: c,
    inboundSid: opts.inboundSid ?? null,
    outboundMessageId: null,
    autoSentAt: null,
    updatedAt: now,
  };
  // Allow the overwrite only when the existing row is NOT ahead of us: not a
  // newer turn, and not a human takeover stamped at this-or-a-newer inbound.
  const setWhere = and(
    or(isNull(t.latestInboundMessageId), lte(t.latestInboundMessageId, c)),
    or(
      ne(t.status, "human_handled"),
      isNull(t.latestInboundMessageId),
      lt(t.latestInboundMessageId, c),
    ),
  )!;
  const written = await db
    .insert(t)
    .values({ tenantId: opts.tenantId, conversationId: opts.conversationId, ...fields })
    .onConflictDoUpdate({ target: t.conversationId, set: fields, setWhere })
    .returning({ id: t.id });
  return written.length > 0;
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
      // Stamp the inbound turn this human takeover answers (the conversation's
      // latest inbound = the message the agent is replying to). This is what
      // lets stageCopilotDraftForInbound / finalizeCopilotDraftForInbound tell a
      // CURRENT-turn human takeover (must not be clobbered) apart from a stale
      // prior-turn human_handled (a fresh turn may overwrite). Without it, a
      // human who sends BEFORE the AI staged anything keeps the previous turn's
      // (smaller) id and the early stream write would wrongly overwrite it.
      latestInboundMessageId: sql`(select max(${messagesTable.id}) from ${messagesTable} where ${messagesTable.conversationId} = ${opts.conversationId} and ${messagesTable.direction} = 'inbound')`,
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
