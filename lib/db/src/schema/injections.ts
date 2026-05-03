import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const injectionsTable = pgTable("injections", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id"),
  toNumber: text("to_number").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull(),
  responseSummary: text("response_summary"),
  conductorAuthorized: boolean("conductor_authorized").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Injection = typeof injectionsTable.$inferSelect;
