import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// ---------------------------------------------------------------------------
// AI auto-reply idempotency claims. The inbound webhook can be retried by the
// carrier (Twilio re-POSTs if it doesn't get a fast 2xx), and our heavy work
// runs fire-and-forget — so a single inbound text could be processed twice.
// Before the Student auto-sends an SMS we INSERT a claim keyed on the inbound
// carrier MessageSid; the unique (tenant_id, inbound_sid) index makes a second
// attempt a no-op, guaranteeing one customer never gets a duplicate auto-reply.
// Rows here are the durable proof that an auto-send already fired for an inbound.
// ---------------------------------------------------------------------------
export const aiAutoRepliesTable = pgTable(
  "ai_auto_replies",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    // Carrier MessageSid of the INBOUND message that triggered the auto-reply.
    inboundSid: text("inbound_sid").notNull(),
    // The outbound messages.id we created for the auto-sent reply (null if the
    // claim was made but the send ultimately failed).
    outboundMessageId: integer("outbound_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantInboundSidIdx: uniqueIndex("ai_auto_replies_tenant_inbound_sid_idx").on(
      t.tenantId,
      t.inboundSid,
    ),
  }),
);

export type AiAutoReply = typeof aiAutoRepliesTable.$inferSelect;
