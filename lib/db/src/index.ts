import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { getTenantDb, getTenantPool } from "./tenant-db";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const globalPool = new Pool({ connectionString: process.env.DATABASE_URL });
const globalDb = drizzle(globalPool, { schema });

/**
 * AsyncLocalStorage for the active tenant slug. When set, the exported `db`
 * and `pool` proxies route to the tenant's per-schema pool. When unset
 * (e.g. cross-tenant background scans, public-only routes), they fall back
 * to the global pool / public schema.
 *
 * Middleware sets this for all authenticated tenant requests; background
 * workers wrap their per-tenant iterations in `withTenantSlug(slug, fn)`.
 */
export const tenantSlugStore = new AsyncLocalStorage<string>();

export function withTenantSlug<T>(
  slug: string,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return tenantSlugStore.run(slug, fn);
}

function activeDb(): NodePgDatabase<typeof schema> {
  const slug = tenantSlugStore.getStore();
  return slug ? getTenantDb(slug) : globalDb;
}

function activePool(): pg.Pool {
  const slug = tenantSlugStore.getStore();
  return slug ? getTenantPool(slug) : globalPool;
}

// Proxies that resolve to the tenant-scoped instance on every property read.
// drizzle query builders return new chainable objects whose internal pool
// reference is captured at .select()/.insert()/.update() time, so each
// statement always uses the tenant pool active at that moment.
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_t, prop) {
    const target = activeDb() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === "function" ? (value as Function).bind(target) : value;
  },
});

export const pool = new Proxy({} as pg.Pool, {
  get(_t, prop) {
    const target = activePool() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === "function" ? (value as Function).bind(target) : value;
  },
});

export * from "./schema";
export {
  getTenantDb,
  getTenantPool,
  tenantSchemaName,
  closeAllTenantPools,
  type TenantDb,
} from "./tenant-db";
export {
  provisionTenantSchema,
  ensureTenantSchema,
  tenantSchemaExists,
} from "./tenant-provisioner";
