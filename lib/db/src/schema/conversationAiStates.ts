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
// Latest AI reply state — exactly ONE row per conversation (unique conversation
// index, upserted on every inbound). This is the single source of truth that
// drives the inbox send-button color ("who has the wheel for THIS reply"):
//   drafted        → Co-Pilot draft waiting in the composer (Yellow)
//   auto_sent      → Auto-Pilot sent it autonomously (Green)
//   failed/refused → Auto-Pilot handed back to a human for this message (Blue)
//   human_handled  → a human took the wheel (no learning for this reply)
//   superseded/idle→ no actionable AI state
// Learning (persisting Professor facts) happens ONLY when status reaches
// auto_sent — i.e. the AI's reply went out verbatim, untouched by a human.
// ---------------------------------------------------------------------------
export const conversationAiStatesTable = pgTable(
  "conversation_ai_states",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id),
    // Free-form text + app-level validation (NO DB CHECK — a single bad row
    // must never 500 the conversation list).
    status: text("status").notNull().default("idle"),
    draftBody: text("draft_body"),
    draftSource: text("draft_source"),
    confidence: text("confidence"),
    queryCategory: text("query_category"),
    // Blue-handback reason surfaced as a chip near the composer.
    reasonCode: text("reason_code"),
    reasonText: text("reason_text"),
    // The inbound this AI state answers (id + carrier SID for idempotency joins).
    latestInboundMessageId: integer("latest_inbound_message_id"),
    inboundSid: text("inbound_sid"),
    outboundMessageId: integer("outbound_message_id"),
    humanHandledBy: integer("human_handled_by"),
    humanHandledAt: timestamp("human_handled_at", { withTimezone: true }),
    autoSentAt: timestamp("auto_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    conversationIdx: uniqueIndex("conversation_ai_states_conversation_idx").on(
      t.conversationId,
    ),
    tenantConvIdx: index("conversation_ai_states_tenant_conv_idx").on(
      t.tenantId,
      t.conversationId,
    ),
  }),
);

export type ConversationAiStateRow = typeof conversationAiStatesTable.$inferSelect;
