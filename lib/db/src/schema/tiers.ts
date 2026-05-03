import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const tiersTable = pgTable("tiers", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  features: text("features").array().notNull().default([]),
});

export type Tier = typeof tiersTable.$inferSelect;
