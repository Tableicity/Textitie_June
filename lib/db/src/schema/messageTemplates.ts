import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { tenantUsersTable } from "./tenantUsers";

export const messageTemplatesTable = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shortcutKey: text("shortcut_key").notNull(),
  body: text("body").notNull(),
  category: text("category"),
  createdBy: integer("created_by")
    .references(() => tenantUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("uq_message_templates_tenant_shortcut").on(table.tenantId, table.shortcutKey),
]);

export type MessageTemplate = typeof messageTemplatesTable.$inferSelect;
