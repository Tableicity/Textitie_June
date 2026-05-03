import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const webhookEventsTable = pgTable("webhook_events", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WebhookEvent = typeof webhookEventsTable.$inferSelect;
