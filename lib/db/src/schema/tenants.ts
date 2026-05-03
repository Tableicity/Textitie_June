import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  tierCode: text("tier_code").notNull(),
  sovereignToggle: boolean("sovereign_toggle").notNull().default(false),
  phoneNumber: text("phone_number"),
  chatwootAccountId: integer("chatwoot_account_id"),
  chatwootInboxId: integer("chatwoot_inbox_id"),
  knowledgeBase: text("knowledge_base"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Tenant = typeof tenantsTable.$inferSelect;
