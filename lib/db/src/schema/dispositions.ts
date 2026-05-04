import { pgTable, serial, text, integer, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const dispositionsTable = pgTable(
  "dispositions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    label: text("label").notNull(),
    color: text("color").notNull().default("#64748b"),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index("dispositions_tenant_idx").on(t.tenantId, t.archived, t.sortOrder),
    tenantLabelUnq: uniqueIndex("dispositions_tenant_label_unq").on(t.tenantId, t.label),
  }),
);

export type Disposition = typeof dispositionsTable.$inferSelect;
