import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// ---------------------------------------------------------------------------
// Brand-safety leak feed — ONE row per "caught a competitor name" event the
// scrubber recorded for a tenant. The deterministic scrubber
// (lib/brand-safety) already rewrites competitor names everywhere; Layer 4
// previously only LOGGED each catch (not queryable from the UI). This table
// persists the catch so the Conductor's Brand Safety tab can show which tenants
// have dirty knowledge / prompts that keep naming a competitor.
//
// Recorded only at the customer-reaching gates:
//   surface = "ai_reply"   → a competitor name was caught in an AI draft /
//                            auto-sent reply (brand-safety Layer 1).
//   surface = "knowledge"  → a competitor name was caught in curated knowledge
//                            as it was published to the groundable Classroom
//                            (brand-safety Layer 2, classroomPublish gate).
// `surface` and `detail` are free-form text + app-level handling (NO DB CHECK —
// a single odd value must never 500 a list query). `detail` is a short machine
// label of the sub-site (e.g. "copilot_draft", "classroom_publish") — never raw
// customer text, to avoid persisting PII.
//
// `residue` is true when a competitor name STILL remained after the scrub (the
// configured competitor list is incomplete) — the error-class signal.
// ---------------------------------------------------------------------------
export const brandSafetyEventsTable = pgTable(
  "brand_safety_events",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      // Cascade like the other append-only audit table (audit_logs): this is a
      // pure leak log with no downstream references, so deleting a tenant should
      // take its events with it and never block the Conductor delete route.
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    surface: text("surface").notNull(),
    detail: text("detail"),
    replacements: integer("replacements").notNull().default(0),
    residue: boolean("residue").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index("brand_safety_events_tenant_created_idx").on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

export type BrandSafetyEvent = typeof brandSafetyEventsTable.$inferSelect;
