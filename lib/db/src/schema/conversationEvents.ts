import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { conversationsTable } from "./conversations";
import { tenantUsersTable } from "./tenantUsers";

export const conversationEventsTable = pgTable("conversation_events", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversationsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  actorId: integer("actor_id")
    .references(() => tenantUsersTable.id, { onDelete: "set null" }),
  targetId: integer("target_id")
    .references(() => tenantUsersTable.id, { onDelete: "set null" }),
  note: text("note"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ConversationEvent = typeof conversationEventsTable.$inferSelect;
