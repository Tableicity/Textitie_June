import { pgTable, serial, integer, text, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const surveysTable = pgTable(
  "surveys",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("csat"),
    enabled: boolean("enabled").notNull().default(false),
    prompt: text("prompt")
      .notNull()
      .default("How would you rate your experience? Please tap the link to leave a rating:"),
    thankYou: text("thank_you").notNull().default("Thanks for your feedback!"),
    sendAfterClose: boolean("send_after_close").notNull().default(true),
    sendDelayMinutes: integer("send_delay_minutes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantTypeUnq: uniqueIndex("surveys_tenant_type_unq").on(t.tenantId, t.type),
  }),
);

export type Survey = typeof surveysTable.$inferSelect;
