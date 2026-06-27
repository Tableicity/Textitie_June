import { pgTable, serial, text, integer, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./tenants";

export const contactsTable = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    phone: text("phone").notNull(),
    name: text("name"),
    email: text("email"),
    notes: text("notes"),
    location: text("location"),
    preferredLanguage: text("preferred_language"),
    tags: text("tags").array(),
    blocked: boolean("blocked").notNull().default(false),
    // Quarantine: contacts imported by the TextLine migration land
    // is_quarantined=true and stay hidden from live contact reads until the
    // operator flips the job live. importExternalId = source TextLine customer id.
    isQuarantined: boolean("is_quarantined").notNull().default(false),
    migrationJobId: integer("migration_job_id"),
    importExternalId: text("import_external_id"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Live contacts are unique per phone, but the index is PARTIAL
    // (WHERE is_quarantined=false) so a quarantined TextLine-imported contact can
    // coexist with a live contact for the same phone until flip-live merges them.
    // EVERY live upsert on (tenant,phone) MUST pass targetWhere:is_quarantined=false
    // to match this partial index (a bare ON CONFLICT (tenant_id,phone) errors).
    tenantPhoneLiveUnq: uniqueIndex("contacts_tenant_phone_live_unq")
      .on(t.tenantId, t.phone)
      .where(sql`${t.isQuarantined} = false`),
    // Idempotent re-import: one imported contact per (tenant, TextLine customer id).
    importExternalUnq: uniqueIndex("contacts_import_external_unq").on(t.tenantId, t.importExternalId),
    tenantLastIdx: index("contacts_tenant_last_idx").on(t.tenantId, t.lastInteractionAt),
  }),
);

export type Contact = typeof contactsTable.$inferSelect;
