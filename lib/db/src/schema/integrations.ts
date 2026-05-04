import { pgTable, serial, integer, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const integrationsTable = pgTable(
  "integrations",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("disconnected"),
    displayName: text("display_name"),
    configJson: jsonb("config_json").notNull().default({}),
    settingsJson: jsonb("settings_json").notNull().default({}),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantProviderUnq: uniqueIndex("integrations_tenant_provider_unq").on(t.tenantId, t.provider),
  }),
);

export type Integration = typeof integrationsTable.$inferSelect;
