import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { surveysTable } from "./surveys";
import { conversationsTable } from "./conversations";

export const surveySendsTable = pgTable(
  "survey_sends",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    surveyId: integer("survey_id")
      .notNull()
      .references(() => surveysTable.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id").references(() => conversationsTable.id, {
      onDelete: "set null",
    }),
    contactPhone: text("contact_phone").notNull(),
    token: text("token").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenUnq: uniqueIndex("survey_sends_token_unq").on(t.token),
    tenantCreatedIdx: index("survey_sends_tenant_created_idx").on(t.tenantId, t.createdAt),
    statusIdx: index("survey_sends_status_idx").on(t.status, t.sentAt),
  }),
);

export type SurveySend = typeof surveySendsTable.$inferSelect;
