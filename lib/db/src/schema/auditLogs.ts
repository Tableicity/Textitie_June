import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    actorUserId: integer("actor_user_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt),
    tenantEntityIdx: index("audit_logs_tenant_entity_idx").on(t.tenantId, t.entityType, t.entityId),
  }),
);

export type AuditLog = typeof auditLogsTable.$inferSelect;
