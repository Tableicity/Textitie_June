import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { tenantUsersTable } from "./tenantUsers";

export const departmentsTable = pgTable("departments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  name: text("name").notNull(),
  phoneNumber: text("phone_number"),
  twilioSid: text("twilio_sid"),
  description: text("description"),
  routingStrategy: text("routing_strategy").notNull().default("round_robin"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Department = typeof departmentsTable.$inferSelect;

export const departmentMembersTable = pgTable(
  "department_members",
  {
    id: serial("id").primaryKey(),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departmentsTable.id, { onDelete: "cascade" }),
    tenantUserId: integer("tenant_user_id")
      .notNull()
      .references(() => tenantUsersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.departmentId, t.tenantUserId)],
);

export type DepartmentMember = typeof departmentMembersTable.$inferSelect;
