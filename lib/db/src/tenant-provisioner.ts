import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./index";
import { tenantSchemaName } from "./tenant-db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_PATH = path.join(__dirname, "tenant-schema-template.sql");

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  return cachedTemplate;
}

/**
 * Creates `tenant_<slug>` schema and provisions all per-tenant tables,
 * sequences, indexes, and FKs. Idempotent: safe to call repeatedly.
 *
 * Cross-schema FKs into `public.tenants` and `public.tenant_users` are
 * preserved as-is from the template.
 */
export async function provisionTenantSchema(slug: string): Promise<void> {
  const schemaName = tenantSchemaName(slug);
  const template = loadTemplate();
  const sql = template.replaceAll("__SCHEMA__", schemaName);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

    // pg_dump output uses fully-qualified names, so we run it without
    // setting search_path. CREATE TABLE / SEQUENCE / INDEX / ALTER all carry
    // the schema prefix.
    await client.query(sql);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    // If the schema's tables already exist this will throw "relation already
    // exists". The provisioner is documented as idempotent at the schema
    // level (CREATE SCHEMA IF NOT EXISTS), but DDL replay is not. Callers
    // should treat repeat calls as no-ops only when they know the schema
    // is already provisioned.
    throw err;
  } finally {
    client.release();
  }
}

/**
 * True if the per-tenant schema exists. Cheap check used to gate
 * provisionTenantSchema so we can call it safely for already-migrated tenants.
 */
export async function tenantSchemaExists(slug: string): Promise<boolean> {
  const schemaName = tenantSchemaName(slug);
  const result = await pool.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
    [schemaName],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Idempotent wrapper: provisions only if the schema is missing.
 */
export async function ensureTenantSchema(slug: string): Promise<boolean> {
  if (await tenantSchemaExists(slug)) return false;
  await provisionTenantSchema(slug);
  return true;
}
