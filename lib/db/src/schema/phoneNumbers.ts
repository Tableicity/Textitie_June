import {
  pgTable,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { departmentsTable } from "./departments";

/**
 * Canonical number -> tenant routing table. THE single source of truth for
 * inbound routing and outbound ownership.
 *
 * `phone_number` is the PRIMARY KEY, so a number belongs to exactly one tenant
 * across BOTH primary numbers and department numbers — platform-wide uniqueness
 * that `tenants.phone_number` / `departments.phone_number` cannot enforce on
 * their own. The resolver does ONE deterministic lookup against this table and
 * fails closed when there is no row (it never falls back to "the first tenant").
 *
 * See John/architecture.doc.md Part 5 (the +18887619212 cross-tenant leak) for
 * why this exists. All writes MUST go through artifacts/api-server's
 * phoneNumberRegistry helper so the denormalized columns stay in sync and
 * cross-tenant conflicts are rejected.
 */
export const phoneNumbersTable = pgTable("phone_numbers", {
  phoneNumber: text("phone_number").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  departmentId: integer("department_id").references(() => departmentsTable.id, {
    onDelete: "cascade",
  }),
  twilioSid: text("twilio_sid"),
  // 'primary' (tenant's own number, department_id null) | 'department'
  kind: text("kind").notNull().default("primary"),
  // 'local' | 'toll_free' — drives carrier billing. Local numbers incur the
  // $15 carrier fee + $10 unregistered surcharge; toll-free numbers are exempt.
  numberType: text("number_type").notNull().default("local"),
  // 'registered' | 'unregistered' — local numbers only. Defaults to
  // 'unregistered' (the registration form is stubbed for now). An unregistered
  // local number carries the $10 surcharge unless the tenant's surcharge is off.
  registrationStatus: text("registration_status").notNull().default("unregistered"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => ({
  // A tenant has at most ONE primary number. Hard DB guarantee so no code path
  // (or concurrent write) can leave two primary rows for one tenant.
  onePrimaryPerTenant: uniqueIndex("phone_numbers_one_primary_per_tenant")
    .on(t.tenantId)
    .where(sql`${t.kind} = 'primary'`),
  // A department maps to at most ONE canonical number row.
  oneRowPerDepartment: uniqueIndex("phone_numbers_one_row_per_department")
    .on(t.departmentId)
    .where(sql`${t.departmentId} IS NOT NULL`),
}));

export const insertPhoneNumberSchema = createInsertSchema(
  phoneNumbersTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertPhoneNumber = z.infer<typeof insertPhoneNumberSchema>;
export type PhoneNumber = typeof phoneNumbersTable.$inferSelect;
