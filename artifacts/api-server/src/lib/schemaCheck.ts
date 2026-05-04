import { pool } from "@workspace/db";
import { logger } from "./logger";

const REQUIRED_TABLES = [
  "tenants",
  "tiers",
  "injections",
  "webhook_events",
  "users",
  "tenant_users",
  "departments",
  "department_members",
  "conversations",
  "messages",
  "conversation_events",
  "usage_records",
  "billing_events",
];

export async function checkSchema(): Promise<string[]> {
  try {
    const result = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );

    const existing = new Set(result.rows.map((r: { table_name: string }) => r.table_name));
    const missing = REQUIRED_TABLES.filter((t) => !existing.has(t));

    if (missing.length > 0) {
      logger.error(
        { missing, existing: [...existing] },
        "SCHEMA CHECK FAILED — missing tables. Run: pnpm --filter @workspace/db run push-force",
      );
    } else {
      logger.info(
        { tables: REQUIRED_TABLES.length },
        "Schema check passed — all required tables present",
      );
    }

    return missing;
  } catch (err) {
    logger.error({ err }, "Schema check failed — could not query database");
    return REQUIRED_TABLES;
  }
}
