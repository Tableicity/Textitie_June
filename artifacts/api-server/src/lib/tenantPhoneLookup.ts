import { db, getTenantPool, tenantsTable, type Tenant } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Resolve which tenant owns an incoming SMS `To` number.
 *
 * Order of lookup:
 *   1. public.tenants.phone_number (tenant's primary number)
 *   2. <tenant_schema>.departments.phone_number across all known tenants
 *
 * Step 2 mirrors the iteration pattern used by deliveryStatus.findMessageBySid.
 * With ~10–100 tenants this is sub-ms; if we ever scale to thousands, swap
 * for a public lookup table (number PK → tenant_slug) written at purchase
 * time in routes/phoneNumbers.ts.
 */
export async function resolveTenantByPhoneNumber(
  toNumber: string,
): Promise<Tenant | null> {
  const [primary] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.phoneNumber, toNumber));
  if (primary) return primary;

  const slugs = await db.select().from(tenantsTable);
  for (const tenant of slugs) {
    try {
      const tpool = getTenantPool(tenant.slug);
      const r = await tpool.query(
        `SELECT 1 FROM departments WHERE phone_number = $1 LIMIT 1`,
        [toNumber],
      );
      if (r.rows.length > 0) return tenant;
    } catch (err) {
      logger.warn(
        { err, slug: tenant.slug },
        "tenant phone lookup failed for tenant (continuing)",
      );
    }
  }
  return null;
}
