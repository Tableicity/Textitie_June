import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { conversationsTable } from "./conversations";

// ---------------------------------------------------------------------------
// Co-Pilot draft "turn" history — ONE row per inbound message that the Co-Pilot
// draft pipeline resolved. Unlike `conversation_ai_states` (which holds only the
// LATEST draft state per conversation and is OVERWRITTEN on every new inbound),
// this is an append-only, timestamped log so we can report, per tenant /
// conversation, how each Co-Pilot turn was drafted:
//   - answered using Knowledge (grounded in the approved Classroom / legacy KB), vs
//   - "raced to Grok" — the Student drafted from its own parametric knowledge
//     with no grounding.
//
// `draftSource` mirrors `conversation_ai_states.draft_source` (free-form text +
// app-level validation, NO DB CHECK — a single bad row must never 500 a
// list/count). Canonical values:
//   student         → main Co-Pilot Student draft (grounding varies — read the
//                     `grounded` column, NOT this value, to tell knowledge-backed
//                     turns apart: an ungrounded inbound with no fallback phrase
//                     configured still lands here)
//   student_flash   → Grok general-knowledge draft (router general_in_scope; never grounded)
//   router_decline  → off-scope decline draft (router out_of_scope)
//   fallback_phrase → Conductor-set holding phrase for an ungrounded tenant-specific inbound
//   professor       → escalation draft (no live runtime site; reserved)
//
// `grounded` is the authoritative knowledge-match signal for the turn (Classroom
// FTS/coverage hit OR the Student's KB match), captured at draft time. Report
// "answered using Knowledge" as grounded = true; "raced to Grok" as grounded =
// false on a student/student_flash source.
//
// `staged` records whether the guarded draft write actually landed in the
// composer (true) or was a no-op because a human took the wheel / a newer turn
// superseded it mid-pipeline (false) — the AI still computed the turn either way.
//
// The unique (tenant_id, inbound_message_id) index makes recording idempotent
// under carrier webhook retries (one inbound text ⇒ at most one turn event), so
// a retry can never double-count a turn — mirroring autopilot_turn_events.
// ---------------------------------------------------------------------------
export const copilotTurnEventsTable = pgTable(
  "copilot_turn_events",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    // The inbound messages.id this Co-Pilot turn drafted for (plain integer, no
    // FK — mirrors conversation_ai_states.latest_inbound_message_id).
    inboundMessageId: integer("inbound_message_id").notNull(),
    // Carrier MessageSid of the inbound (nullable — not every inbound has one).
    inboundSid: text("inbound_sid"),
    // How the draft was produced (see header). Free-form text, app-validated.
    draftSource: text("draft_source").notNull(),
    // Authoritative knowledge-match signal for THIS turn (do not infer from
    // draftSource — a "student" draft can be ungrounded).
    grounded: boolean("grounded").notNull(),
    // Whether the guarded draft write actually staged into the composer.
    staged: boolean("staged").notNull().default(true),
    // Classifier bucket for the inbound (pricing|compliance|features|… ), nullable.
    queryCategory: text("query_category"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantInboundMsgIdx: uniqueIndex(
      "copilot_turn_events_tenant_inbound_msg_idx",
    ).on(t.tenantId, t.inboundMessageId),
    tenantConvCreatedIdx: index(
      "copilot_turn_events_tenant_conv_created_idx",
    ).on(t.tenantId, t.conversationId, t.createdAt),
  }),
);

export type CopilotTurnEvent = typeof copilotTurnEventsTable.$inferSelect;
