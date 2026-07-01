import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./tenants";

/**
 * CSV Contact Import — a lighter, self-contained SIBLING of the TextLine
 * Migration ("Smasher"). Conductor-operated, lives in Admin -> Tenant ->
 * Migration tab as its own Card. It deliberately mirrors Migration's
 * quarantine -> review -> flip-live safety model, but on its OWN rails so the
 * TextLine Migration build is never touched (Option 2 / "parallel lane").
 *
 * Two tables:
 *   - csv_import_jobs: the per-tenant review-gate state machine (one row per
 *     uploaded file).
 *   - csv_import_rows: the parsed + validated staging of every data row from
 *     the uploaded CSV, kept OUTSIDE the live contacts table. Nothing reaches
 *     `contacts` until the operator flips the job live (flip-live INSERTs live
 *     rows; discard just deletes these staging rows). This keeps the live App
 *     pristine — an un-reviewed import can never appear in it.
 *
 * Both are strictly tenant_id-scoped.
 */

// Canonical job lifecycle (plain text, NO DB enum/check so a bad value can
// never 500 a list query — same rule as engagement modes / migration status):
//   review (staged, waiting on the operator) -> complete (flipped live)
//   review -> discarded ; (any) -> failed
// Parsing is synchronous at upload time, so a fresh job lands directly at
// 'review'. There is no worker/extract phase (that is the whole point vs the
// TextLine Migration).
export const csvImportJobsTable = pgTable(
  "csv_import_jobs",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    // "csv" today; column kept generic to mirror migration_jobs.source.
    source: text("source").notNull().default("csv"),
    status: text("status").notNull().default("review"),
    originalFilename: text("original_filename"),
    // Review + flip results for the operator summary, e.g.
    // { total, valid, duplicate, invalid, sampleInvalid: [...],
    //   sampleDuplicate: [...], flippedAt, inserted, updated, skipped }.
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    // Superuser id that created the job, when available (best-effort).
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // Race-safe single active import per tenant: a PARTIAL unique index over
    // tenant_id for every NON-terminal status (mirrors migration_jobs). Only
    // one un-reviewed staged batch can exist per tenant at a time; the loser of
    // a concurrent upload gets 23505 -> 409. Terminal jobs are excluded so a
    // tenant can always start a fresh import afterward.
    oneActivePerTenantUnq: uniqueIndex("csv_import_jobs_one_active_per_tenant_unq")
      .on(t.tenantId)
      .where(sql`${t.status} NOT IN ('complete', 'discarded', 'failed')`),
    statusIdx: index("csv_import_jobs_status_idx").on(t.status),
    // Per-tenant listing (newest first).
    tenantCreatedIdx: index("csv_import_jobs_tenant_created_idx").on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

export type CsvImportJob = typeof csvImportJobsTable.$inferSelect;

export const csvImportRowsTable = pgTable(
  "csv_import_rows",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => csvImportJobsTable.id, { onDelete: "cascade" }),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    // 1-based line number of the data row within the uploaded file (for the
    // operator to locate a bad row).
    rowNumber: integer("row_number").notNull(),
    // Parsed, normalized fields. phone is canonical E.164 or NULL when the row
    // is invalid (missing/unparseable phone).
    phone: text("phone"),
    name: text("name"),
    email: text("email"),
    location: text("location"),
    notes: text("notes"),
    tags: text("tags").array(),
    // Faithful original row object as parsed from the CSV (never shredded away).
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull(),
    // 'valid'    -> new contact to INSERT on flip-live
    // 'duplicate'-> phone already matches a LIVE contact; operator resolves
    //               (update vs skip) per-import at flip-live
    // 'invalid'  -> missing/unparseable phone; reported, never imported
    status: text("status").notNull(),
    errorReason: text("error_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    jobIdx: index("csv_import_rows_job_idx").on(t.jobId),
    jobStatusIdx: index("csv_import_rows_job_status_idx").on(t.jobId, t.status),
  }),
);

export type CsvImportRow = typeof csvImportRowsTable.$inferSelect;
