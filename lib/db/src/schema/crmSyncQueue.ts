import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const crmSyncQueueTable = pgTable(
  "crm_sync_queue",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    op: text("op").notNull(),
    payloadJson: jsonb("payload_json").notNull().default({}),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    externalId: text("external_id"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index("crm_sync_queue_tenant_status_idx").on(t.tenantId, t.status, t.nextAttemptAt),
    pendingIdx: index("crm_sync_queue_pending_idx").on(t.status, t.nextAttemptAt),
  }),
);

export type CrmSyncQueueItem = typeof crmSyncQueueTable.$inferSelect;
