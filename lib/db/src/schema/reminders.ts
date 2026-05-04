import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { tenantUsersTable } from "./tenantUsers";
import { conversationsTable } from "./conversations";

export const remindersTable = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => tenantUsersTable.id, { onDelete: "cascade" }),
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    note: text("note"),
    firedAt: timestamp("fired_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantUserIdx: index("reminders_tenant_user_idx").on(t.tenantId, t.userId, t.dismissedAt),
    pendingIdx: index("reminders_pending_idx").on(t.firedAt, t.remindAt),
    convIdx: index("reminders_conv_idx").on(t.conversationId),
  }),
);

export type Reminder = typeof remindersTable.$inferSelect;
