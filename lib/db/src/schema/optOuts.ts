import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const optOutsTable = pgTable("opt_outs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull(),
  reason: text("reason"),
  optedOutAt: timestamp("opted_out_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("opt_outs_tenant_phone_idx").on(table.tenantId, table.phoneNumber),
]);

export type OptOut = typeof optOutsTable.$inferSelect;
