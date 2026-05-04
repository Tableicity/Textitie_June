import { pgTable, serial, text, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { conversationsTable } from "./conversations";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("draft"),
  segmentFilter: jsonb("segment_filter"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  queuedCount: integer("queued_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  responseCount: integer("response_count").notNull().default(0),
  optOutCount: integer("opt_out_count").notNull().default(0),
  creditsRequired: integer("credits_required").notNull().default(0),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type Campaign = typeof campaignsTable.$inferSelect;

export const campaignMessagesTable = pgTable("campaign_messages", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaignsTable.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id")
    .references(() => conversationsTable.id, { onDelete: "set null" }),
  contactPhone: text("contact_phone").notNull(),
  contactName: text("contact_name"),
  renderedBody: text("rendered_body").notNull(),
  status: text("status").notNull().default("queued"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  errorMessage: text("error_message"),
});

export type CampaignMessage = typeof campaignMessagesTable.$inferSelect;
