import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, tenantsTable } from "@workspace/db";
import { UpdateBrandSafetyConfigBody } from "@workspace/api-zod";
import {
  brandName,
  competitorNames,
  parseCompetitorNames,
} from "@workspace/brand-safety";
import {
  listRecentBrandSafetyEvents,
  invalidateTenantExtraCompetitors,
} from "../lib/brandSafetyStore";

/**
 * Brand-safety Conductor routes. All paths live under
 * `/tenants/:tenantId/brand-safety...`, which is NOT in conductorAuth's
 * tenant-scoped allow-list, so they require Conductor (admin) auth by default
 * (mirrors the Brain + Migrations routes).
 *
 * The platform brand name + base competitor list are env-driven and read-only
 * here; the Conductor can only edit the PER-TENANT extra competitor list that is
 * layered on top of the base. The events feed surfaces every recent "caught a
 * competitor name" leak so an operator can spot tenants whose knowledge/prompts
 * keep naming a competitor.
 */

const router: IRouter = Router();

const EVENTS_LIMIT = 50;
// Defensive caps so a Conductor paste can't bloat the CSV column or the scrub
// regex. App-level only (the column is free-form text, no DB CHECK).
const MAX_EXTRA_COMPETITORS = 100;
const MAX_NAME_LEN = 80;

function parseId(value: unknown): number | null {
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

async function getTenant(tenantId: number) {
  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  return tenant ?? null;
}

// Normalize an incoming extra-competitor list: trim, cap length, drop empties,
// dedupe case-insensitively, cap count. Returns the cleaned list.
function normalizeExtras(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of raw) {
    const trimmed = name.trim().slice(0, MAX_NAME_LEN);
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_EXTRA_COMPETITORS) break;
  }
  return out;
}

function configFor(extraCsv: string | null) {
  return {
    brandName: brandName(),
    baseCompetitors: competitorNames(),
    extraCompetitors: parseCompetitorNames(extraCsv),
  };
}

// --- Get config --------------------------------------------------------------
router.get(
  "/tenants/:tenantId/brand-safety/config",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    res.json(configFor(tenant.competitorNamesExtra));
  },
);

// --- Update config (extra competitor list only) ------------------------------
router.patch(
  "/tenants/:tenantId/brand-safety/config",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const parsed = UpdateBrandSafetyConfigBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid brand-safety input" });
      return;
    }
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const extras = normalizeExtras(parsed.data.extraCompetitors);
    const csv = extras.length > 0 ? extras.join(", ") : null;
    await db
      .update(tenantsTable)
      .set({ competitorNamesExtra: csv })
      .where(eq(tenantsTable.id, tenantId));
    // Drop the scrubber's cached extras so the edit takes effect immediately.
    invalidateTenantExtraCompetitors(tenantId);
    req.log.info(
      { tenantId, count: extras.length },
      "brand-safety: updated tenant extra competitor list",
    );
    res.json(configFor(csv));
  },
);

// --- List recent leak events -------------------------------------------------
router.get(
  "/tenants/:tenantId/brand-safety/events",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const events = await listRecentBrandSafetyEvents(tenantId, EVENTS_LIMIT);
    res.json(events);
  },
);

export default router;
