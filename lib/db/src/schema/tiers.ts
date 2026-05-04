import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";

export const tiersTable = pgTable("tiers", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  features: text("features").array().notNull().default([]),
  monthlyPriceCents: integer("monthly_price_cents").notNull().default(0),
  includedCredits: integer("included_credits").notNull().default(0),
  trialDays: integer("trial_days").notNull().default(14),
  maxAgents: integer("max_agents").notNull().default(1),
  maxPhoneNumbers: integer("max_phone_numbers").notNull().default(1),
  hipaaEligible: boolean("hipaa_eligible").notNull().default(false),
});

export type Tier = typeof tiersTable.$inferSelect;
