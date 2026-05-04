import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const billingEventsTable = pgTable("billing_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  fromTier: text("from_tier"),
  toTier: text("to_tier"),
  amountCents: integer("amount_cents"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BillingEvent = typeof billingEventsTable.$inferSelect;
