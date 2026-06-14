import { db, phoneNumbersTable, tenantsTable, type Tenant } from "@workspace/db";
import { eq } from "drizzle-orm";
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
