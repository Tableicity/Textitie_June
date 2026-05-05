import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { tenantUsersTable } from "./tenantUsers";

export const emailVerificationsTable = pgTable("email_verifications", {
  id: serial("id").primaryKey(),
  tenantUserId: integer("tenant_user_id")
    .notNull()
    .references(() => tenantUsersTable.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EmailVerification = typeof emailVerificationsTable.$inferSelect;
