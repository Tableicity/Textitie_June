import { pgTable, serial, text, integer, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { departmentsTable } from "./departments";
import { tenantUsersTable } from "./tenantUsers";

export const conversationsTable = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    departmentId: integer("department_id")
      .references(() => departmentsTable.id, { onDelete: "set null" }),
    contactId: integer("contact_id"),
    contactPhone: text("contact_phone").notNull(),
    contactName: text("contact_name"),
    status: text("status").notNull().default("open"),
    dispositionId: integer("disposition_id"),
    resolutionNote: text("resolution_note"),
    // Per-conversation engagement mode override (manual|copilot|autopilot).
    // null = inherit the tenant's engagementMode. App-validated, no DB CHECK.
    engagementModeOverride: text("engagement_mode_override"),
    tags: text("tags").array(),
    // Quarantine: rows imported by the TextLine migration assembly line land
    // is_quarantined=true and stay hidden from EVERY live read path until the
    // operator flips the migration job live. migrationJobId is a plain integer
    // (no FK) to avoid a schema import cycle; importExternalId = source TextLine
    // conversation id, for idempotent re-runs.
    isQuarantined: boolean("is_quarantined").notNull().default(false),
    migrationJobId: integer("migration_job_id"),
    importExternalId: text("import_external_id"),
    assignedUserId: integer("assigned_user_id")
      .references(() => tenantUsersTable.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index("conversations_tenant_created_idx").on(t.tenantId, t.createdAt),
    // Idempotent re-import: one conversation per (tenant, TextLine id). NULLs are
    // distinct in Postgres, so all pre-existing non-imported rows coexist freely.
    importExternalUnq: uniqueIndex("conversations_import_external_unq").on(t.tenantId, t.importExternalId),
  }),
);

export type Conversation = typeof conversationsTable.$inferSelect;

export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id),
    direction: text("direction").notNull(),
    body: text("body").notNull(),
    senderName: text("sender_name"),
    read: boolean("read").notNull().default(false),
    externalId: text("external_id"),
    // Quarantine flag for TextLine-migrated messages (hidden from live reads
    // until the job is flipped live). migrationJobId is a plain integer (no FK).
    // importExternalId = source TextLine post id, for idempotent re-import.
    isQuarantined: boolean("is_quarantined").notNull().default(false),
    migrationJobId: integer("migration_job_id"),
    importExternalId: text("import_external_id"),
    status: text("status").notNull().default("sent"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    convDirCreatedIdx: index("messages_conv_dir_created_idx").on(t.conversationId, t.direction, t.createdAt),
    convCreatedIdx: index("messages_conv_created_idx").on(t.conversationId, t.createdAt),
    // Idempotent re-import: one message per (conversation, TextLine post id).
    // NULLs are distinct in Postgres so all live (non-imported) rows coexist.
    importExternalUnq: uniqueIndex("messages_import_external_unq").on(t.conversationId, t.importExternalId),
  }),
);

export type Message = typeof messagesTable.$inferSelect;
