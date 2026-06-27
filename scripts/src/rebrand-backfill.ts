/**
 * Brand-safety backfill (DEVELOPMENT ONLY).
 *
 * Rewrites competitor names to the canonical brand in EXISTING rows of
 * `absorbed_facts` and `classroom_facts`. New writes are already scrubbed at the
 * source (extraction, Brain staging) and at the Classroom publish gate, so this
 * only matters for data written before the guardrails landed.
 *
 * Production note: the agent has read-only access to the prod database, so do
 * NOT point this at prod. Existing prod facts are cleaned by re-pushing each
 * tenant's Classroom (the publish snapshot scrubs every statement), which is a
 * Conductor action.
 *
 *   pnpm --filter @workspace/scripts run rebrand-backfill
 */
import { Pool } from "pg";
import { rebrandText } from "@workspace/brand-safety";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function backfillTable(table: string, cols: string[]): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, ${cols.join(", ")} FROM ${table}`,
  );
  let updated = 0;
  for (const row of rows as Record<string, unknown>[]) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const col of cols) {
      const cur = row[col];
      if (typeof cur !== "string" || cur.length === 0) continue;
      const next = rebrandText(cur).text;
      if (next !== cur) {
        sets.push(`${col} = $${i}`);
        vals.push(next);
        i += 1;
      }
    }
    if (sets.length > 0) {
      vals.push(row["id"]);
      await pool.query(
        `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${i}`,
        vals,
      );
      updated += 1;
    }
  }
  console.log(`${table}: scanned ${rows.length}, updated ${updated}`);
}

async function main(): Promise<void> {
  console.log("Brand-safety backfill (DEV) — rewriting competitor names…");
  await backfillTable("absorbed_facts", ["statement", "source_label"]);
  await backfillTable("classroom_facts", ["statement", "source_label"]);
  await pool.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
