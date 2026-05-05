import { pgTable, serial, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
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
    tags: text("tags").array(),
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
    tenantPhoneUnq: uniqueIndex("contacts_tenant_phone_unq").on(t.tenantId, t.phone),
    tenantLastIdx: index("contacts_tenant_last_idx").on(t.tenantId, t.lastInteractionAt),
  }),
);

export type Contact = typeof contactsTable.$inferSelect;
