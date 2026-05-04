import { pgTable, serial, text, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { departmentsTable } from "./departments";
import { tenantUsersTable } from "./tenantUsers";

export const conversationsTable = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    departmentId: integer("department_id")
      .references(() => departmentsTable.id, { onDelete: "set null" }),
    contactId: integer("contact_id"),
    contactPhone: text("contact_phone").notNull(),
    contactName: text("contact_name"),
    status: text("status").notNull().default("open"),
    dispositionId: integer("disposition_id"),
    resolutionNote: text("resolution_note"),
    tags: text("tags").array(),
    assignedUserId: integer("assigned_user_id")
      .references(() => tenantUsersTable.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index("conversations_tenant_created_idx").on(t.tenantId, t.createdAt),
  }),
);

export type Conversation = typeof conversationsTable.$inferSelect;

export const messagesTable = pgTable(
  "messages",
  {
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
  },
  (t) => ({
    convDirCreatedIdx: index("messages_conv_dir_created_idx").on(t.conversationId, t.direction, t.createdAt),
    convCreatedIdx: index("messages_conv_created_idx").on(t.conversationId, t.createdAt),
  }),
);

export type Message = typeof messagesTable.$inferSelect;
