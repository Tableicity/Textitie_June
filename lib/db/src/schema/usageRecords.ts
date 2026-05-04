import { pgTable, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const usageRecordsTable = pgTable("usage_records", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  messagesSent: integer("messages_sent").notNull().default(0),
  creditsUsed: integer("credits_used").notNull().default(0),
  creditsIncluded: integer("credits_included").notNull().default(0),
  overageCredits: integer("overage_credits").notNull().default(0),
  overageAmountCents: integer("overage_amount_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("uq_usage_tenant_period").on(table.tenantId, table.periodStart),
]);

export type UsageRecord = typeof usageRecordsTable.$inferSelect;
