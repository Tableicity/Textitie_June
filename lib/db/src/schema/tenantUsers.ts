import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const tenantUsersTable = pgTable("tenant_users", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type TenantUser = typeof tenantUsersTable.$inferSelect;
