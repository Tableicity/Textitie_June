import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { surveySendsTable } from "./surveySends";

export const surveyResponsesTable = pgTable(
  "survey_responses",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    sendId: integer("send_id")
      .notNull()
      .references(() => surveySendsTable.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    comment: text("comment"),
    respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => ({
    sendUnq: uniqueIndex("survey_responses_send_unq").on(t.sendId),
    tenantRespondedIdx: index("survey_responses_tenant_responded_idx").on(t.tenantId, t.respondedAt),
  }),
);

export type SurveyResponse = typeof surveyResponsesTable.$inferSelect;
