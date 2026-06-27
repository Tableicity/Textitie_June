import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { conversationsTable } from "./conversations";

// ---------------------------------------------------------------------------
// Auto-Pilot conversational "turn" history — ONE row per inbound message that
// the closed-book Auto-Pilot fail-open handler resolved. Unlike
// `conversation_ai_states` (which holds only the LATEST state per conversation),
// this is an append-only, timestamped log so we can count the fallback circuit
// breaker tallies:
//   - consecutive: trailing fallback/error/stepdown outcomes since the last
//     `answer` (resets to 0 on any answered turn), and
//   - rolling 2-minute window: fallback-class outcomes within the last 2 min.
//
// `outcome` is free-form text + app-level validation (NO DB CHECK — a single bad
// row must never 500 a list/count). Canonical values:
//   answer               → stitched a grounded reply from the approved Classroom
//   fallback             → no match; sent a graceful out-of-scope ack (GREEN)
//   error_fallback       → responder/LLM error; sent a fallback ack (never silent)
//   stepdown_consecutive → 3rd consecutive fallback; final ack + stepped to BLUE
//   stepdown_window      → >3 fallbacks within 2 min; final ack + stepped to BLUE
//   compliance_block     → hard compliance/opt-out suppressed the AI
// Breaker counting (see engagementPolicy.computeAutoPilotFallbackCounts):
//   - `fallback` and `error_fallback` are the UNANSWERED turns that increment
//     the tally.
//   - `answer` and `stepdown_*` are run boundaries (a successful answer, or a
//     prior stepdown after which a human re-enabled Auto-Pilot — start fresh).
//   - `compliance_block` is neutral (legal suppression, not a knowledge miss):
//     it is recorded for audit but neither increments nor resets the tally.
//
// The unique (tenant_id, inbound_message_id) index makes recording idempotent
// under carrier webhook retries (one inbound text ⇒ at most one turn event), so
// a retry can never double-count the breaker.
// ---------------------------------------------------------------------------
export const autopilotTurnEventsTable = pgTable(
  "autopilot_turn_events",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id),
    // The inbound messages.id this Auto-Pilot turn answered (plain integer, no
    // FK — mirrors conversation_ai_states.latest_inbound_message_id).
    inboundMessageId: integer("inbound_message_id").notNull(),
    // Carrier MessageSid of the inbound (nullable — not every inbound has one).
    inboundSid: text("inbound_sid"),
    // Canonical outcome (see header). Free-form text, app-validated.
    outcome: text("outcome").notNull(),
    // What kind of reply (if any) went out: grounded_answer | fallback_ack |
    // final_ack | null (nothing sent, e.g. compliance suppression).
    replyKind: text("reply_kind"),
    // The outbound messages.id we created for this turn's reply (null when no
    // reply was sent).
    outboundMessageId: integer("outbound_message_id"),
    // Machine reason code for audit/debug (e.g. the stepdown reason).
    reasonCode: text("reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantInboundMsgIdx: uniqueIndex(
      "autopilot_turn_events_tenant_inbound_msg_idx",
    ).on(t.tenantId, t.inboundMessageId),
    tenantConvCreatedIdx: index(
      "autopilot_turn_events_tenant_conv_created_idx",
    ).on(t.tenantId, t.conversationId, t.createdAt),
  }),
);

export type AutopilotTurnEvent = typeof autopilotTurnEventsTable.$inferSelect;
