import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./tenants";

/**
 * LLM hierarchy — knowledge layer.
 *
 * Library (raw sources) -> Professor (human-curated absorption) ->
 * Classroom (published, versioned) -> Students (consume published knowledge).
 *
 * All tables are tenant-scoped on tenant_id. Retrieval is Postgres full-text
 * search (tsvector + GIN) for now; the chunk/fact tables are shaped so a
 * pgvector embedding column can be added later without restructuring.
 */

// ---------------------------------------------------------------------------
// Library — raw source documents (file upload, website URL, pasted text, or
// the migrated legacy knowledge_base blob).
// ---------------------------------------------------------------------------
export const knowledgeDocumentsTable = pgTable(
  "knowledge_documents",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    // "file" | "url" | "paste" | "legacy"
    sourceType: text("source_type").notNull(),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    // Reserved for future object-storage retention of the raw original.
    storageKey: text("storage_key"),
    extractedText: text("extracted_text").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    // "ready" | "processing" | "error"
    status: text("status").notNull().default("ready"),
    errorMessage: text("error_message"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index("knowledge_documents_tenant_created_idx").on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

export type KnowledgeDocument = typeof knowledgeDocumentsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Library chunks — documents split into retrievable units, FTS-indexed.
// ---------------------------------------------------------------------------
export const knowledgeChunksTable = pgTable(
  "knowledge_chunks",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    documentId: integer("document_id")
      .notNull()
      .references(() => knowledgeDocumentsTable.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index("knowledge_chunks_tenant_idx").on(t.tenantId),
    ftsIdx: index("knowledge_chunks_fts_idx").using(
      "gin",
      sql`to_tsvector('english', ${t.text})`,
    ),
  }),
);

export type KnowledgeChunk = typeof knowledgeChunksTable.$inferSelect;

// ---------------------------------------------------------------------------
// Professor sessions — human-in-the-loop curation chats. Max 5 active before
// a "Push to Classroom" is required (enforced in the service layer).
// ---------------------------------------------------------------------------
export const professorSessionsTable = pgTable(
  "professor_sessions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    title: text("title").notNull(),
    // "active" | "archived" | "pushed"
    status: text("status").notNull().default("active"),
    model: text("model").notNull(),
    tokensUsed: integer("tokens_used").notNull().default(0),
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
    tenantStatusIdx: index("professor_sessions_tenant_status_idx").on(
      t.tenantId,
      t.status,
    ),
  }),
);

export type ProfessorSession = typeof professorSessionsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Professor chat messages.
// ---------------------------------------------------------------------------
export const professorMessagesTable = pgTable(
  "professor_messages",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => professorSessionsTable.id, { onDelete: "cascade" }),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    // "user" | "assistant" | "system"
    role: text("role").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionCreatedIdx: index("professor_messages_session_created_idx").on(
      t.sessionId,
      t.createdAt,
    ),
  }),
);

export type ProfessorMessage = typeof professorMessagesTable.$inferSelect;

// ---------------------------------------------------------------------------
// Absorbed facts — discrete knowledge the Professor extracted during a session.
// Grouped for display by sourceLabel (each group renders as an "absorbed
// knowledge" card with a fact count).
// ---------------------------------------------------------------------------
export const absorbedFactsTable = pgTable(
  "absorbed_facts",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    sessionId: integer("session_id").references(
      () => professorSessionsTable.id,
      { onDelete: "set null" },
    ),
    documentId: integer("document_id"),
    // Set when the fact was absorbed from a Professor chat answer (vs. an
    // attached source document). Lets the UI mark an answer as absorbed and
    // keeps re-absorbing the same answer idempotent.
    messageId: integer("message_id"),
    sourceLabel: text("source_label").notNull(),
    statement: text("statement").notNull(),
    // "draft" | "published" | "auto_published" | "rejected" | "conflict".
    //  - "auto_published": a fact LEARNED autonomously by the live Professor
    //    escalation flywheel. Groundable + auto-sendable immediately (mirrored
    //    into classroom_facts, which has no status), but provisional: it shows in
    //    the Conductor review queue until a human approves (-> "published") or
    //    rejects (-> "rejected").
    //  - "conflict": set by the Librarian at push time when a fact contradicts
    //    another accepted fact, OR by the escalation persist path's deterministic
    //    lexical/category check; the Conductor resolves it by re-accepting
    //    (published) or rejecting one side. Carries conflictReason.
    // Plain text (no DB enum/check) so a bad value can never 500 a list query.
    status: text("status").notNull().default("draft"),
    // Routing category — "pricing" | "compliance" | "features" |
    // "technical_setup" | "general". Plain text (no DB enum/check) + app-level
    // validation so a bad value can never 500 a list query; default "general".
    category: text("category").notNull().default("general"),
    // Human-readable explanation set alongside status "conflict" so the
    // Conductor can see WHY two facts collide (e.g. differing prices). Also
    // reused to carry a Brain-import flag reason ("flagged" candidates render
    // unchecked in the Brain review card). Null for clean / every other status.
    conflictReason: text("conflict_reason"),
    // Provenance of the fact. "professor" = human/Professor curation (default,
    // so existing rows + the Professor flow are untouched); "brain" = harvested
    // by the external Brain pull. Plain text + app-level validation (no DB enum)
    // so a bad value can never 500 a list query.
    source: text("source").notNull().default("professor"),
    // External source URL for Brain-harvested facts (audit provenance). Null for
    // Professor-curated facts.
    sourceUrl: text("source_url"),
    tokenCount: integer("token_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantSessionIdx: index("absorbed_facts_tenant_session_idx").on(
      t.tenantId,
      t.sessionId,
    ),
  }),
);

export type AbsorbedFact = typeof absorbedFactsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Classroom — published, versioned snapshots of curated knowledge. Students
// only ever read the current published version.
// ---------------------------------------------------------------------------
export const classroomVersionsTable = pgTable(
  "classroom_versions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    version: integer("version").notNull(),
    // "published" | "superseded"
    status: text("status").notNull().default("published"),
    summary: text("summary"),
    factCount: integer("fact_count").notNull().default(0),
    tokenCount: integer("token_count").notNull().default(0),
    publishedBy: integer("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index("classroom_versions_tenant_status_idx").on(
      t.tenantId,
      t.status,
    ),
  }),
);

export type ClassroomVersion = typeof classroomVersionsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Classroom facts — the published knowledge the Students retrieve, FTS-indexed.
// ---------------------------------------------------------------------------
export const classroomFactsTable = pgTable(
  "classroom_facts",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    versionId: integer("version_id")
      .notNull()
      .references(() => classroomVersionsTable.id, { onDelete: "cascade" }),
    sourceLabel: text("source_label").notNull(),
    statement: text("statement").notNull(),
    // Routing category carried over from the absorbed fact at push time.
    category: text("category").notNull().default("general"),
    tokenCount: integer("token_count").notNull().default(0),
  },
  (t) => ({
    versionIdx: index("classroom_facts_version_idx").on(t.versionId),
    tenantIdx: index("classroom_facts_tenant_idx").on(t.tenantId),
    // The "fast switch": B-tree for instant category scoping during retrieval.
    tenantCategoryIdx: index("classroom_facts_tenant_category_idx").on(
      t.tenantId,
      t.category,
    ),
    ftsIdx: index("classroom_facts_fts_idx").using(
      "gin",
      sql`to_tsvector('english', ${t.statement})`,
    ),
  }),
);

export type ClassroomFact = typeof classroomFactsTable.$inferSelect;
