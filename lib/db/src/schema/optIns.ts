import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const optInsTable = pgTable(
  "opt_ins",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    source: text("source").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    evidenceUrl: text("evidence_url"),
    note: text("note"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    tenantPhoneUnq: uniqueIndex("opt_ins_tenant_phone_unq").on(t.tenantId, t.phone),
    tenantConsentedIdx: index("opt_ins_tenant_consented_idx").on(t.tenantId, t.consentedAt),
  }),
);

export type OptIn = typeof optInsTable.$inferSelect;
