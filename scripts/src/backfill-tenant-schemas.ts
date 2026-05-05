import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
function schemaFor(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`Unsafe slug: ${slug}`);
  return `tenant_${slug.replace(/-/g, "_")}`;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Tables that have tenant_id directly. Order matters — parents before children
// for FK satisfaction inside the per-tenant schema.
// Order matters for FKs WITHIN per-tenant schema:
//   opt_outs -> campaigns
//   conversations -> departments
//   reminders -> conversations
//   survey_sends -> surveys (and -> conversations, optional)
//   survey_responses -> survey_sends
const TENANT_ID_TABLES = [
  "departments",
  "contacts",
  "automation_rules",
  "message_templates",
  "dispositions",
  "opt_ins",
  "campaigns",
  "opt_outs",
  "conversations",
  "audit_logs",
  "billing_events",
  "crm_sync_queue",
  "integrations",
  "reminders",
  "surveys",
  "survey_sends",
  "survey_responses",
  "usage_records",
] as const;

// Child tables — filter by parent's tenant_id via JOIN.
const CHILD_TABLES: { table: string; parent: string; parentFk: string }[] = [
  { table: "messages", parent: "conversations", parentFk: "conversation_id" },
  { table: "campaign_messages", parent: "campaigns", parentFk: "campaign_id" },
  { table: "department_members", parent: "departments", parentFk: "department_id" },
];

async function tableColumns(table: string): Promise<string[]> {
  const r = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.map((row) => row.column_name);
}

async function copyTenantTable(
  schemaName: string,
  table: string,
  tenantId: number,
): Promise<number> {
  const cols = await tableColumns(table);
  if (cols.length === 0) return 0;
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const sql = `
    INSERT INTO "${schemaName}"."${table}" (${colList})
    SELECT ${colList} FROM public."${table}"
    WHERE tenant_id = $1
    ON CONFLICT DO NOTHING
  `;
  const r = await pool.query(sql, [tenantId]);
  return r.rowCount ?? 0;
}

async function copyChildTable(
  schemaName: string,
  child: { table: string; parent: string; parentFk: string },
  tenantId: number,
): Promise<number> {
  const cols = await tableColumns(child.table);
  if (cols.length === 0) return 0;
  const colList = cols.map((c) => `c."${c}"`).join(", ");
  const insertCols = cols.map((c) => `"${c}"`).join(", ");
  const sql = `
    INSERT INTO "${schemaName}"."${child.table}" (${insertCols})
    SELECT ${colList}
    FROM public."${child.table}" c
    JOIN public."${child.parent}" p ON p.id = c."${child.parentFk}"
    WHERE p.tenant_id = $1
    ON CONFLICT DO NOTHING
  `;
  const r = await pool.query(sql, [tenantId]);
  return r.rowCount ?? 0;
}

async function fixSequences(schemaName: string): Promise<void> {
  // Reset each per-tenant sequence to MAX(id)+1 so new inserts don't collide.
  const seqs = await pool.query<{ seq: string; tbl: string; col: string }>(
    `SELECT
       sequence_name AS seq,
       table_name AS tbl,
       column_name AS col
     FROM information_schema.columns c
     JOIN information_schema.sequences s
       ON s.sequence_schema = c.table_schema
      AND s.sequence_name = c.table_name || '_' || c.column_name || '_seq'
     WHERE c.table_schema = $1`,
    [schemaName],
  );
  for (const { seq, tbl, col } of seqs.rows) {
    await pool.query(
      `SELECT setval('"${schemaName}"."${seq}"',
         COALESCE((SELECT MAX("${col}") FROM "${schemaName}"."${tbl}"), 0) + 1,
         false)`,
    );
  }
}

async function backfillTenant(tenantId: number, slug: string): Promise<void> {
  const schemaName = schemaFor(slug);
  console.log(`\n[${schemaName}] (tenant_id=${tenantId})`);
  let total = 0;
  for (const t of TENANT_ID_TABLES) {
    const n = await copyTenantTable(schemaName, t, tenantId);
    if (n > 0) console.log(`    ${t.padEnd(24)} +${n}`);
    total += n;
  }
  for (const c of CHILD_TABLES) {
    const n = await copyChildTable(schemaName, c, tenantId);
    if (n > 0) console.log(`    ${c.table.padEnd(24)} +${n} (via ${c.parent})`);
    total += n;
  }
  await fixSequences(schemaName);
  console.log(`    [done] ${total} rows copied, sequences advanced`);
}

async function verify(tenantId: number, slug: string): Promise<void> {
  const schemaName = schemaFor(slug);
  console.log(`\n[${schemaName}] verification:`);
  for (const t of TENANT_ID_TABLES) {
    const a = await pool.query(
      `SELECT count(*)::int AS c FROM public."${t}" WHERE tenant_id = $1`,
      [tenantId],
    );
    const b = await pool.query(
      `SELECT count(*)::int AS c FROM "${schemaName}"."${t}"`,
    );
    const ok = a.rows[0].c === b.rows[0].c ? "✓" : "✗";
    if (a.rows[0].c > 0 || b.rows[0].c > 0) {
      console.log(`    ${ok} ${t.padEnd(24)} public=${a.rows[0].c} tenant=${b.rows[0].c}`);
    }
  }
}

async function main() {
  const tenants = await pool.query<{ id: number; slug: string }>(
    "SELECT id, slug FROM tenants ORDER BY id",
  );
  for (const t of tenants.rows) {
    await backfillTenant(t.id, t.slug);
  }
  for (const t of tenants.rows) {
    await verify(t.id, t.slug);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
