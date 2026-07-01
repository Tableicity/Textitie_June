import { db, tenantsTable, phoneNumbersTable } from "@workspace/db";
import { and, count, eq, isNotNull, lte, sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Tenant lifecycle: reversible soft-archive → scheduled/manual hard purge.
 *
 * Archive (routes/tenants.ts) stamps `lifecycle_status='archived'` +
 * `purge_after = now + PURGE_WINDOW_MS`. The 60s timer (timerEngine) calls
 * `processTenantPurge`, which HARD-deletes archived tenants whose window has
 * elapsed — but ONLY once they own zero canonical phone numbers, so an automated
 * job can never silently drop routing rows for numbers that stay live + billed on
 * Twilio (the operator must unassign / return them to the pool first, or use the
 * slug-confirmed manual clean-slate delete). Restore reverses archive.
 */

// Default soft-archive → purge window. 30 days gives the operator a wide,
// reversible grace period before a hard delete becomes irreversible.
export const PURGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Seed/demo tenants that seedDemoData re-creates on every boot. Archiving or
// deleting them is pointless (they come back) and risky, so every destructive
// lifecycle path refuses them. Shared by the routes and the purge job.
export const PROTECTED_TENANT_SLUGS = new Set(["acme"]);

/**
 * Count the canonical `phone_numbers` rows a tenant still owns (primary +
 * department). The purge safety guard: an archived tenant that still owns
 * numbers is never auto-purged.
 */
export async function countOwnedPhoneNumbers(tenantId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(phoneNumbersTable)
    .where(eq(phoneNumbersTable.tenantId, tenantId));
  return row?.n ?? 0;
}

/**
 * Dependency-ordered HARD delete of a tenant and all of its scoped data, inside
 * one transaction. The children below are ON DELETE NO ACTION / RESTRICT
 * (messages via conversations, reminders, conversations, contacts, dispositions,
 * phone_numbers, departments, tenant_users) so they are deleted explicitly in
 * order; every other child is ON DELETE CASCADE and goes with the tenant row.
 *
 * phone_numbers is deleted BEFORE departments so the tenant's primary rows
 * (department_id IS NULL, not covered by the departments cascade) are cleared and
 * the phone_numbers.tenant_id RESTRICT FK is satisfied when the tenant row goes.
 */
// Drizzle transaction handle type, so the purge job can lock + recheck + delete
// a tenant all inside ONE transaction (see processTenantPurge).
type LifecycleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The ordered DELETEs of a hard-delete, scoped to a caller-supplied transaction
 * so the purge job can run the lock/recheck and the delete atomically. See
 * hardDeleteTenant for the ordering rationale.
 */
async function hardDeleteTenantTx(tx: LifecycleTx, id: number): Promise<void> {
  await tx.execute(
    sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ${id})`,
  );
  await tx.execute(sql`DELETE FROM reminders WHERE tenant_id = ${id}`);
  await tx.execute(sql`DELETE FROM conversations WHERE tenant_id = ${id}`);
  await tx.execute(sql`DELETE FROM contacts WHERE tenant_id = ${id}`);
  await tx.execute(sql`DELETE FROM dispositions WHERE tenant_id = ${id}`);
  await tx.execute(sql`DELETE FROM phone_numbers WHERE tenant_id = ${id}`);
  await tx.execute(sql`DELETE FROM departments WHERE tenant_id = ${id}`);
  await tx.execute(sql`DELETE FROM tenant_users WHERE tenant_id = ${id}`);
  await tx.execute(sql`DELETE FROM tenants WHERE id = ${id}`);
}

export async function hardDeleteTenant(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await hardDeleteTenantTx(tx, id);
  });
}

/**
 * Scheduled purge: hard-delete archived tenants whose purge window has elapsed.
 * Bounded per cycle. Protected slugs are skipped. A tenant that still owns phone
 * numbers is skipped with a visible `purge_blocked_reason` (never auto-released).
 * A failed delete is logged and retried next cycle (no partial state — the whole
 * delete is one transaction). Returns the number of tenants actually purged.
 */
export async function processTenantPurge(): Promise<number> {
  // Cheap unlocked pre-filter to bound the work per cycle. Every candidate is
  // RE-checked under a row lock below, so a stale/racy read here is harmless.
  const candidates = await db
    .select({
      id: tenantsTable.id,
      slug: tenantsTable.slug,
    })
    .from(tenantsTable)
    .where(
      and(
        eq(tenantsTable.lifecycleStatus, "archived"),
        isNotNull(tenantsTable.purgeAfter),
        lte(tenantsTable.purgeAfter, new Date()),
      ),
    )
    .limit(25);

  let purged = 0;
  for (const t of candidates) {
    if (PROTECTED_TENANT_SLUGS.has(t.slug)) continue;

    try {
      const outcome = await db.transaction(async (tx) => {
        // Lock the tenant row, but ONLY if it is STILL archived AND past its
        // purge window. A restore (lifecycle_status → 'active') or a cleared
        // purge_after that landed between candidate selection and now filters the
        // row out here → 0 rows → we never hard-delete a no-longer-eligible
        // tenant (closes the restore-vs-purge TOCTOU data-loss race). Concurrent
        // purge cycles serialize on this lock: the loser re-reads the (now gone
        // or restored) row and skips.
        const locked = await tx.execute(sql`
          SELECT id FROM tenants
          WHERE id = ${t.id}
            AND lifecycle_status = 'archived'
            AND purge_after IS NOT NULL
            AND purge_after <= NOW()
          FOR UPDATE
        `);
        if (locked.rows.length === 0) return "skipped" as const;

        // Recount owned numbers INSIDE the locked tx. The FOR UPDATE lock on the
        // tenant row forces a concurrent phone_numbers INSERT (which needs an FK
        // key-share lock on this same tenant row) to block until we commit, so a
        // number assigned mid-purge is either counted here (→ skip) or fails
        // after our delete — it can never be silently orphaned/dropped.
        const cnt = await tx.execute(
          sql`SELECT COUNT(*)::int AS n FROM phone_numbers WHERE tenant_id = ${t.id}`,
        );
        const owned = Number((cnt.rows[0] as { n: number } | undefined)?.n ?? 0);
        if (owned > 0) {
          const reason = `Still owns ${owned} phone number(s); unassign / return them to the pool (or use the manual clean-slate delete) before purge.`;
          await tx.execute(
            sql`UPDATE tenants SET purge_blocked_reason = ${reason} WHERE id = ${t.id}`,
          );
          return "owns_numbers" as const;
        }

        await hardDeleteTenantTx(tx, t.id);
        return "purged" as const;
      });

      if (outcome === "purged") {
        purged += 1;
        logger.warn(
          { tenantId: t.id, slug: t.slug },
          "Archived tenant purged (scheduled hard delete)",
        );
      } else if (outcome === "owns_numbers") {
        logger.warn(
          { tenantId: t.id, slug: t.slug },
          "Scheduled tenant purge skipped: tenant still owns phone numbers",
        );
      }
    } catch (err) {
      logger.error(
        { err, tenantId: t.id, slug: t.slug },
        "Scheduled tenant purge failed (will retry next cycle)",
      );
    }
  }
  return purged;
}
