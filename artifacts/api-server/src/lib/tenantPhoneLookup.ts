import {
  db,
  phoneNumbersTable,
  tenantsTable,
  departmentsTable,
  type Tenant,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { normalizePhoneE164 } from "./phoneNumberRegistry";
import { logger } from "./logger";

/**
 * Resolve which tenant owns an incoming SMS `To` number.
 *
 * Single deterministic lookup against the canonical `phone_numbers` table
 * (`phone_number` is the PRIMARY KEY, so at most one tenant matches). Covers
 * both tenant primary numbers and department numbers. Fails CLOSED: an unknown
 * number returns null (handled upstream as an unassigned lead) and is NEVER
 * routed to "the first tenant" / ACME. See John/architecture.doc.md Part 5.
 */
export async function resolveTenantByPhoneNumber(
  toNumber: string,
): Promise<Tenant | null> {
  let norm: string | null;
  try {
    norm = normalizePhoneE164(toNumber);
  } catch {
    logger.warn(
      { toNumber },
      "inbound To is not valid E.164; refusing to route",
    );
    return null;
  }
  if (!norm) return null;

  const rows = await db
    .select({ tenant: tenantsTable })
    .from(phoneNumbersTable)
    .innerJoin(tenantsTable, eq(phoneNumbersTable.tenantId, tenantsTable.id))
    .where(eq(phoneNumbersTable.phoneNumber, norm))
    .limit(1);

  return rows[0]?.tenant ?? null;
}

/**
 * Resolve which department a NEW inbound conversation should land in.
 *
 * The agent inbox no longer surfaces an "All Departments"/"Unassigned" bucket,
 * so a conversation with department_id = null would be invisible. Precedence:
 *   1. The department that owns the inbound `To` number in the canonical
 *      phone_numbers table (a `kind='department'` row).
 *   2. Otherwise the tenant's default (oldest) department — for a freshly
 *      signed-up tenant that is the auto-created "Demo Department".
 *   3. If the tenant has no departments at all (legacy tenants), null. The
 *      inbox hides its department filter in that case, so these stay visible.
 */
export async function resolveInboundDepartmentId(
  tenantId: number,
  toNumber: string,
): Promise<number | null> {
  let norm: string | null = null;
  try {
    norm = normalizePhoneE164(toNumber);
  } catch {
    norm = null;
  }

  if (norm) {
    const owned = await db
      .select({ departmentId: phoneNumbersTable.departmentId })
      .from(phoneNumbersTable)
      .where(
        and(
          eq(phoneNumbersTable.phoneNumber, norm),
          eq(phoneNumbersTable.tenantId, tenantId),
        ),
      )
      .limit(1);
    const ownedDeptId = owned[0]?.departmentId ?? null;
    if (ownedDeptId != null) return ownedDeptId;
  }

  // Fall back to the tenant's default (oldest) department — the signup-seeded
  // "Demo Department" for new tenants.
  const defaultDept = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.tenantId, tenantId))
    .orderBy(asc(departmentsTable.id))
    .limit(1);
  return defaultDept[0]?.id ?? null;
}
