import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// ---------------------------------------------------------------------------
// Internal, per-tenant notifications surfaced to the tenant (e.g. trial
// lifecycle nudges: "7 days left", "2 days left", "trial ended"). This is also
// the idempotency spine for the timer-engine trial processor: a UNIQUE
// (tenant_id, type) makes each lifecycle fire land exactly once across the 60s
// poll cycles (insert ... ON CONFLICT DO NOTHING). When a real email provider
// is wired, the same rows are the "outbox" to send from. Plain text `type`
// (NO DB CHECK) so a new notification kind can never 500 a read.
// ---------------------------------------------------------------------------
export const tenantNotificationsTable = pgTable(
  "tenant_notifications",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    // e.g. trial_reminder_day_7 | trial_reminder_day_2 | trial_expired
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // Optional in-app CTA target, e.g. "/billing".
    actionUrl: text("action_url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTypeUnq: uniqueIndex("tenant_notifications_tenant_type_idx").on(
      t.tenantId,
      t.type,
    ),
    tenantIdx: index("tenant_notifications_tenant_read_idx").on(
      t.tenantId,
      t.readAt,
    ),
  }),
);

export type TenantNotification = typeof tenantNotificationsTable.$inferSelect;
