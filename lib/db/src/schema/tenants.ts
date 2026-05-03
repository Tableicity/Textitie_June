import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  tierCode: text("tier_code").notNull(),
  sovereignToggle: boolean("sovereign_toggle").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Tenant = typeof tenantsTable.$inferSelect;
