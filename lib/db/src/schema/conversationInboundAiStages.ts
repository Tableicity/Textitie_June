import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./tenants";
import { conversationsTable, messagesTable } from "./conversations";

// ---------------------------------------------------------------------------
// Inbound AI staging — the durable, per-conversation FIFO queue for the AI
// engagement pipeline (Student draft / Co-Pilot finalize / Auto-Pilot gate +
// auto-send / Professor escalation). It hangs off the persisted conversation
// stream: every row references a real conversation + inbound message (the log),
// NOT a throwaway in-memory queue.
//
// Why a table (vs. the old in-process escalation Map):
//   - durable across restarts and safe across multiple deployed instances,
//   - lets us SERIALIZE per conversation (one inbound's AI runs at a time) so
//     three rapid texts never interleave their pipelines, while different
//     conversations still run in parallel,
//   - gives retries/backoff + a visibility timeout for crashed workers.
//
// Only the AI pipeline is staged. Contact/conversation/message persistence,
// the realtime `message:new` push, and the automation engine all stay on the
// immediate post-ack path in routes/webhooks.ts so the inbound text shows in
// the inbox instantly — we only enqueue here for copilot/autopilot inbounds
// the automation engine did NOT already handle.
//
// status lifecycle (plain text + app-level validation — NO DB CHECK, so a
// single bad row can never 500 a list endpoint):
//   queued     → waiting for the worker
//   processing → a worker owns it (enforced single-in-flight per conversation
//                by the partial unique index below)
//   done       → the AI pipeline ran to completion
//   skipped    → not run on purpose (mode flipped to manual, coalesced into a
//                newer turn, or a human already took the wheel)
//   failed     → exhausted retries
// ---------------------------------------------------------------------------
export const conversationInboundAiStagesTable = pgTable(
  "conversation_inbound_ai_stages",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    // The inbound message this stage answers. UNIQUE → enqueue is idempotent
    // under carrier webhook retries (one stage per inbound message).
    inboundMessageId: integer("inbound_message_id")
      .notNull()
      .references(() => messagesTable.id, { onDelete: "cascade" }),
    // Carrier MessageSid of the inbound, threaded into the auto-send idempotency
    // claim (ai_auto_replies). Nullable for injected/non-carrier inbounds.
    inboundSid: text("inbound_sid"),
    // Immutable snapshot of the inbound text + sender phone so the worker has
    // the exact query to process without racing a later edit.
    messageBody: text("message_body").notNull(),
    fromNumber: text("from_number").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    // The durable ordering key — FIFO within a conversation is `received_at ASC`.
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Earliest time the worker may claim this row (bumped on retry backoff).
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    lastError: text("last_error"),
    skipReason: text("skip_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // One stage per inbound message → idempotent enqueue on webhook retry.
    inboundMessageIdx: uniqueIndex(
      "conversation_inbound_ai_stages_inbound_message_idx",
    ).on(t.inboundMessageId),
    // The serialization backstop: at most ONE processing row per conversation.
    // The claimer only picks conversations with no processing row; this partial
    // unique index makes the invariant DB-enforced even across instances.
    oneProcessingPerConvIdx: uniqueIndex(
      "conversation_inbound_ai_stages_one_processing_idx",
    )
      .on(t.conversationId)
      .where(sql`${t.status} = 'processing'`),
    // Claim scan: oldest eligible queued rows first.
    claimIdx: index("conversation_inbound_ai_stages_claim_idx").on(
      t.status,
      t.availableAt,
      t.receivedAt,
    ),
    // Per-conversation ordering (FIFO + coalescing lookups).
    tenantConvIdx: index("conversation_inbound_ai_stages_tenant_conv_idx").on(
      t.tenantId,
      t.conversationId,
      t.receivedAt,
    ),
  }),
);

export type ConversationInboundAiStage =
  typeof conversationInboundAiStagesTable.$inferSelect;
