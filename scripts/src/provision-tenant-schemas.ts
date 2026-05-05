import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const TEMPLATE_PATH = path.resolve(
  process.cwd(),
  "../lib/db/src/tenant-schema-template.sql",
);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function schemaFor(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`Unsafe slug: ${slug}`);
  return `tenant_${slug.replace(/-/g, "_")}`;
}

const template = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function provision(slug: string): Promise<"created" | "exists"> {
  const schemaName = schemaFor(slug);
  const exists = await pool.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
    [schemaName],
  );
  if (exists.rowCount && exists.rowCount > 0) return "exists";

  const sql = template.replaceAll("__SCHEMA__", schemaName);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(sql);
    await client.query("COMMIT");
    return "created";
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const tenants = await pool.query<{ slug: string; name: string }>(
    "SELECT slug, name FROM tenants ORDER BY id",
  );

  console.log(`Found ${tenants.rowCount} tenants. Provisioning schemas...\n`);
  for (const t of tenants.rows) {
    const schema = schemaFor(t.slug);
    process.stdout.write(`  ${schema.padEnd(30)} `);
    try {
      const status = await provision(t.slug);
      console.log(status === "created" ? "✓ created" : "· exists");
    } catch (err) {
      console.log(`✗ FAIL: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }

  // Verify table count per schema (sanity check the template applied fully)
  console.log("\nTable count per schema:");
  for (const t of tenants.rows) {
    const schema = schemaFor(t.slug);
    const r = await pool.query(
      "SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = $1",
      [schema],
    );
    console.log(`  ${schema.padEnd(30)} ${r.rows[0].c} tables`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
