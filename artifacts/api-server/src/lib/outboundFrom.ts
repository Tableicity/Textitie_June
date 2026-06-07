import { db, tenantsTable, departmentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * Strict number↔tenant binding for outbound SMS.
 *
 * A tenant-scoped send (tenantId != null) may only go out on a number the
 * tenant actually owns — passed as `fromOverride` (its own phone_number, or one
 * of its departments'). If it has none, or the supplied number belongs to a
 * different tenant, we REFUSE rather than falling back to / borrowing the
 * global `SAMA_FROM_NUMBER`.
 *
 * Why this matters: the global default is itself a real tenant's number. When a
 * numberless tenant borrowed it, the outbound went out on that number and every
 * reply routed to the number's OWNER — splitting one conversation across two
 * tenants' inboxes (outbound under the borrower, inbound under the owner).
 *
 * Platform-level sends (tenantId == null) are deliberate conductor operations
 * with no tenant to split, so they may still use the configured default.
 */
export const NO_SENDING_NUMBER_MESSAGE =
  "This account has no sending number assigned. Assign a number in Admin → Tenant → Telephony before sending — the platform will not borrow another tenant's number.";

export const NUMBER_NOT_OWNED_MESSAGE =
  "The sending number does not belong to this account. A tenant may only send from a number it owns.";

export type FromGuard =
  | { ok: true }
  | { ok: false; reason: "no_sending_number" | "number_not_owned"; message: string };

/**
 * Cheap, synchronous presence check — for fast user-facing 422s on paths that
 * have already resolved `fromOverride` from the tenant's own rows (so ownership
 * is guaranteed and only emptiness needs to be caught).
 */
export function guardOutboundFrom(params: {
  tenantId: number | null;
  fromOverride: string | null | undefined;
}): FromGuard {
  const { tenantId, fromOverride } = params;
  if (tenantId != null && !fromOverride) {
    return {
      ok: false,
      reason: "no_sending_number",
      message: NO_SENDING_NUMBER_MESSAGE,
    };
  }
  return { ok: true };
}

/**
 * Authoritative, ownership-verifying check — used by the sender backstop, the
 * single choke point every outbound path funnels through. Confirms the supplied
 * `fromOverride` actually belongs to `tenantId` (its own number or one of its
 * departments') before allowing the send. This holds the line even if a future
 * or buggy caller passes an arbitrary or another tenant's number.
 */
export async function verifyOutboundFromOwnership(params: {
  tenantId: number | null;
  fromOverride: string | null | undefined;
}): Promise<FromGuard> {
  const { tenantId, fromOverride } = params;

  // Platform-level send (no tenant to split): allow the configured default.
  if (tenantId == null) return { ok: true };

  if (!fromOverride) {
    return {
      ok: false,
      reason: "no_sending_number",
      message: NO_SENDING_NUMBER_MESSAGE,
    };
  }

  const ownTenant = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, tenantId), eq(tenantsTable.phoneNumber, fromOverride)))
    .limit(1);
  if (ownTenant.length > 0) return { ok: true };

  const ownDept = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(
      and(
        eq(departmentsTable.tenantId, tenantId),
        eq(departmentsTable.phoneNumber, fromOverride),
      ),
    )
    .limit(1);
  if (ownDept.length > 0) return { ok: true };

  return {
    ok: false,
    reason: "number_not_owned",
    message: NUMBER_NOT_OWNED_MESSAGE,
  };
}
