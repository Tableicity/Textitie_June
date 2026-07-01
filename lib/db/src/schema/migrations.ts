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
 * TextLine Migration Assembly Line ("TextLine Smasher").
 *
 * A Conductor-operated, durable, resumable pipeline that imports a tenant's
 * competitor (TextLine) data into Texitie. Two tables:
 *
 *  - migration_jobs: the per-tenant state machine (one row per migration run).
 *  - migration_raw_data: faithful, re-transformable JSONB staging of every
 *    TextLine API page/record, keyed by job + a stable record key so a
 *    resume/retry never double-stages a page (mirrors the webhook_events /
 *    inbound-AI-stage "stage the raw payload" precedent — never shred into
 *    rigid columns at extract time).
 *
 * Both are strictly tenant_id-scoped. Imported rows land QUARANTINED in the
 * live conversations/messages/contacts tables (is_quarantined=true) and are
 * only revealed once the operator flips the migration job live.
 */

// Canonical job lifecycle (plain text, no DB enum/check so a bad value can
// never 500 a list query — same rule as engagement modes / fact status):
//   pending -> extracting -> extracted -> verifying -> review
//     (waiting on the operator) -> hydrating -> complete
//   (any stage) -> failed ; review/complete -> discarded
// NOTE: the verify pass gates STRAIGHT to 'review' — there is no live 'verified'
// transition. 'verified' is a retained LEGACY value (still tolerated by the UI
// status list + the discard set) but the runtime never sets it.
export const migrationJobsTable = pgTable(
  "migration_jobs",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    // "textline" today; column kept generic for future source systems.
    source: text("source").notNull().default("textline"),
    status: text("status").notNull().default("pending"),
    // Entity currently being extracted (conversations | conversation_posts |
    // customers | agents | departments). Null when not extracting.
    currentEntity: text("current_entity"),
    // Page cursor for the current entity's page-number pagination (resume point).
    pageCursor: integer("page_cursor").notNull().default(0),
    // Per-entity raw extracted counts, e.g. { conversations: 1200, posts: 8000 }.
    counts: jsonb("counts")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    // Verify + hydrate results for the operator review summary, e.g.
    // { contacts: { imported, deduped, flagged }, conversations: {...}, anomalies: [...] }.
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    // TextLine access token, AES-256-GCM encrypted at rest. The customer's
    // credential, not a platform secret: held only for the job's extraction and
    // cleared (set null) once extraction completes or the job ends. NEVER logged.
    accessTokenEnc: text("access_token_enc"),
    // Backoff visibility: the worker skips this job until now() passes this.
    rateLimitedUntil: timestamp("rate_limited_until", { withTimezone: true }),
    // Consecutive-failure counter (NOT a claim counter): reset to 0 on any
    // successful progress, incremented only on a transient extraction error, and
    // the job is parked 'failed' once it crosses the worker's attempt cap.
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    // Crash-safe worker lease (visibility timeout). A claimed job is stamped with
    // leased_until = now()+TTL and a fresh lease_token; ONLY the holder of the
    // matching token may heartbeat/advance/release it, so a paused old worker can
    // never write after a new worker reclaims an expired lease (lease fencing).
    // Distinct from rate_limited_until, which is 429 backoff shown to the operator.
    leasedUntil: timestamp("leased_until", { withTimezone: true }),
    leaseToken: text("lease_token"),
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
    tenantStatusIdx: index("migration_jobs_tenant_status_idx").on(
      t.tenantId,
      t.status,
    ),
    statusIdx: index("migration_jobs_status_idx").on(t.status),
    // Race-safe single active migration per tenant: a PARTIAL unique index over
    // tenant_id for every NON-terminal status. Two concurrent starts can both
    // pass the app-level pre-check, but only one INSERT survives this constraint
    // (the loser gets 23505 -> 409). Terminal jobs (complete/failed/discarded)
    // are excluded so a tenant can always start a fresh run afterward.
    oneActivePerTenantUnq: uniqueIndex(
      "migration_jobs_one_active_per_tenant_unq",
    )
      .on(t.tenantId)
      .where(sql`${t.status} NOT IN ('complete', 'failed', 'discarded')`),
    // Worker claim scan: next claimable job by status, then readiness
    // (rate_limited_until), then age — so FOR UPDATE SKIP LOCKED is cheap.
    claimIdx: index("migration_jobs_claim_idx").on(
      t.status,
      t.rateLimitedUntil,
      t.createdAt,
    ),
    // Per-tenant listing (newest first).
    tenantCreatedIdx: index("migration_jobs_tenant_created_idx").on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

export type MigrationJob = typeof migrationJobsTable.$inferSelect;

export const migrationRawDataTable = pgTable(
  "migration_raw_data",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => migrationJobsTable.id, { onDelete: "cascade" }),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    // conversations | conversation_posts | customers | agents | departments
    entity: text("entity").notNull(),
    page: integer("page").notNull().default(0),
    // Stable, unique-within-job dedupe key so a resume/retry re-stages
    // idempotently: `${entity}:p${page}` for list pages, `${entity}:${externalId}`
    // for per-record pulls (e.g. one conversation's posts).
    recordKey: text("record_key").notNull(),
    // Faithful TextLine API response for this unit (whole page or record).
    payload: jsonb("payload").$type<unknown>().notNull(),
    // Number of records this blob contains (for progress display).
    recordCount: integer("record_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    jobKeyUnq: uniqueIndex("migration_raw_data_job_key_unq").on(
      t.jobId,
      t.recordKey,
    ),
    jobEntityIdx: index("migration_raw_data_job_entity_idx").on(
      t.jobId,
      t.entity,
    ),
  }),
);

export type MigrationRawData = typeof migrationRawDataTable.$inferSelect;
