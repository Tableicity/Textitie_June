import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set for tenant DB pool");
}

export type TenantDb = NodePgDatabase<typeof schema>;

interface CachedPool {
  pool: pg.Pool;
  db: TenantDb;
}

const tenantPools = new Map<string, CachedPool>();

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function assertSafeSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid tenant slug for DB routing: ${JSON.stringify(slug)}`,
    );
  }
}

function schemaFor(slug: string): string {
  assertSafeSlug(slug);
  return `tenant_${slug.replace(/-/g, "_")}`;
}

export function tenantSchemaName(slug: string): string {
  return schemaFor(slug);
}

/**
 * Returns a Drizzle instance whose underlying connections always run with
 * `search_path = tenant_<slug>, public`. Cached per slug for the process
 * lifetime — first call lazily builds the pool.
 */
export function getTenantDb(slug: string): TenantDb {
  const cached = tenantPools.get(slug);
  if (cached) return cached.db;

  const schemaName = schemaFor(slug);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Set search_path for every new connection in this pool.
  pool.on("connect", (client) => {
    // Identifiers can't be parameterised, but schemaName is validated above.
    client.query(`SET search_path TO "${schemaName}", public`).catch(() => {
      /* connection error is surfaced elsewhere */
    });
  });

  const db = drizzle(pool, { schema });
  tenantPools.set(slug, { pool, db });
  return db;
}

/**
 * Returns the raw pg.Pool whose connections always run with
 * `search_path = tenant_<slug>, public`. Use this for raw SQL paths
 * (`pool.query("...")`) that previously hit the global pool. Cached per
 * slug — same pool that backs `getTenantDb(slug)`.
 */
export function getTenantPool(slug: string): pg.Pool {
  // Force pool creation via getTenantDb so the on-connect search_path hook
  // is registered exactly once per slug.
  getTenantDb(slug);
  // Safe: guaranteed present after getTenantDb above.
  return tenantPools.get(slug)!.pool;
}

/**
 * Closes all cached tenant pools. Used by tests and graceful shutdown.
 */
export async function closeAllTenantPools(): Promise<void> {
  const pools = Array.from(tenantPools.values());
  tenantPools.clear();
  await Promise.all(pools.map(({ pool }) => pool.end()));
}
