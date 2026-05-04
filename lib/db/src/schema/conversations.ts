import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  contactPhone: text("contact_phone").notNull(),
  contactName: text("contact_name"),
  status: text("status").notNull().default("open"),
  assignedUserId: integer("assigned_user_id"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Conversation = typeof conversationsTable.$inferSelect;

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversationsTable.id),
  direction: text("direction").notNull(),
  body: text("body").notNull(),
  senderName: text("sender_name"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Message = typeof messagesTable.$inferSelect;
