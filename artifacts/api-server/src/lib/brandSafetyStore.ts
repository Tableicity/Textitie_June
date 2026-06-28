import { desc, eq } from "drizzle-orm";
import {
  db,
  brandSafetyEventsTable,
  tenantsTable,
  type BrandSafetyEvent,
} from "@workspace/db";
import { parseCompetitorNames } from "@workspace/brand-safety";
import { logger } from "./logger";

/**
 * Persistence + read helpers for the brand-safety leak feed and the per-tenant
 * extra competitor list. Kept separate from the pure scrub engine
 * (lib/brand-safety) and the logging wrapper (brandSafety.ts) so the scrub
 * stays I/O-free.
 */

/**
 * Best-effort: record one "caught a competitor name" event. NEVER throws — a
 * failed audit write must never break an outbound reply or a knowledge publish,
 * so callers fire-and-forget this and the error is logged, not propagated.
 */
export async function recordBrandSafetyEvent(args: {
  tenantId: number;
  surface: string;
  detail?: string | null;
  replacements: number;
  residue: boolean;
}): Promise<void> {
  try {
    await db.insert(brandSafetyEventsTable).values({
      tenantId: args.tenantId,
      surface: args.surface,
      detail: args.detail ?? null,
      replacements: args.replacements,
      residue: args.residue,
    });
  } catch (err) {
    logger.error(
      { err, tenantId: args.tenantId, surface: args.surface },
      "brand-safety: failed to record leak event (non-fatal)",
    );
  }
}

/** Recent leak events for a tenant, newest first. */
export async function listRecentBrandSafetyEvents(
  tenantId: number,
  limit = 50,
): Promise<BrandSafetyEvent[]> {
  return db
    .select()
    .from(brandSafetyEventsTable)
    .where(eq(brandSafetyEventsTable.tenantId, tenantId))
    .orderBy(desc(brandSafetyEventsTable.createdAt))
    .limit(limit);
}

// --- Per-tenant extra competitor list (short-TTL cache) ----------------------
// The scrubber runs on every AI reply and knowledge publish; reading the tenant
// row each time would add a query to the hot path. Cache the parsed extras for
// a short window and invalidate explicitly when the Conductor edits them.
const EXTRA_TTL_MS = 60_000;
const extraCache = new Map<number, { names: string[]; expiresAt: number }>();

/**
 * The tenant's per-tenant extra competitor names (parsed from the CSV column),
 * cached for EXTRA_TTL_MS. Fail-open: any error returns [] so the base list
 * still applies and scrubbing never breaks.
 */
export async function getTenantExtraCompetitors(
  tenantId: number,
): Promise<string[]> {
  const cached = extraCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.names;
  let names: string[] = [];
  try {
    const [row] = await db
      .select({ extra: tenantsTable.competitorNamesExtra })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    names = parseCompetitorNames(row?.extra ?? null);
  } catch (err) {
    logger.error(
      { err, tenantId },
      "brand-safety: failed to load tenant extra competitors (using base list)",
    );
    names = [];
  }
  extraCache.set(tenantId, { names, expiresAt: Date.now() + EXTRA_TTL_MS });
  return names;
}

/** Drop a tenant's cached extras so a Conductor edit takes effect immediately. */
export function invalidateTenantExtraCompetitors(tenantId: number): void {
  extraCache.delete(tenantId);
}
