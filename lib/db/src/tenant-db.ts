import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set for tenant DB pool");
}

export type TenantDb = NodePgDatabase<typeof schema>;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function assertSafeSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid tenant slug for DB routing: ${JSON.stringify(slug)}`,
    );
  }
}

export function tenantSchemaName(slug: string): string {
  assertSafeSlug(slug);
  return `tenant_${slug.replace(/-/g, "_")}`;
}

/**
 * Stage-4 cleanup (deferred): Per-tenant Postgres schemas were originally
 * intended to give each customer their own `tenant_<slug>.*` namespace, but
 * only the *write* side of the inbound pipeline was migrated. The *read* side
 * (the inbox UI in artifacts/user-app) still queries `public.*` directly,
 * which created a split-brain where inbound messages, auto-replies, and
 * campaign attribution writes vanished from the inbox in any environment
 * where the tenant schema actually existed.
 *
 * Until we genuinely need cross-customer DB-level isolation (a SOC2 / HIPAA
 * / sovereign-data driver), every code path uses the global `db` / `pool`
 * with explicit `tenantId` scoping on each table. All tables that need
 * per-tenant scoping (`opt_outs`, `automation_rules`, `campaigns`,
 * `reminders`, `audit_logs`, `conversations`, …) carry a `tenant_id` FK,
 * and `messages` inherits scoping via `conversation_id`.
 *
 * `getTenantDb` and `getTenantPool` therefore return the global pool. The
 * `slug` parameter is preserved (and still validated) so call sites don't
 * need to change and so we can re-enable per-tenant routing later by simply
 * changing this file.
 */

let cachedPool: pg.Pool | null = null;
let cachedDb: TenantDb | null = null;

function ensureGlobal(): { pool: pg.Pool; db: TenantDb } {
  if (cachedPool && cachedDb) return { pool: cachedPool, db: cachedDb };
  cachedPool = new Pool({ connectionString: process.env.DATABASE_URL });
  cachedDb = drizzle(cachedPool, { schema });
  return { pool: cachedPool, db: cachedDb };
}

export function getTenantDb(slug: string): TenantDb {
  assertSafeSlug(slug);
  return ensureGlobal().db;
}

export function getTenantPool(slug: string): pg.Pool {
  assertSafeSlug(slug);
  return ensureGlobal().pool;
}

/**
 * Closes the cached pool. Used by tests and graceful shutdown.
 */
export async function closeAllTenantPools(): Promise<void> {
  const pool = cachedPool;
  cachedPool = null;
  cachedDb = null;
  if (pool) await pool.end();
}
