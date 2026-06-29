import { Router } from "express";
import { db, tenantsTable, tiersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";
import { recordAudit } from "../lib/audit";
import { setHipaaEnabled } from "../lib/logger";
import { ENGAGEMENT_MODES, normalizeEngagementMode } from "../lib/engagementPolicy";
import { loadOwnerSignupPhone } from "../lib/demoTextingGate";
import { normalizePhoneE164 } from "../lib/phoneNumberRegistry";

const router = Router();

async function loadTenantSettings(tenantId: number) {
  const rows = await db
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      slug: tenantsTable.slug,
      region: tenantsTable.region,
      phoneNumber: tenantsTable.phoneNumber,
      tierCode: tenantsTable.tierCode,
      quietHoursStart: tenantsTable.quietHoursStart,
      quietHoursEnd: tenantsTable.quietHoursEnd,
      quietHoursTz: tenantsTable.quietHoursTz,
      frequencyCapPerDay: tenantsTable.frequencyCapPerDay,
      requireDoubleOptIn: tenantsTable.requireDoubleOptIn,
      hipaaEnabled: tenantsTable.hipaaEnabled,
      baaAcknowledgedAt: tenantsTable.baaAcknowledgedAt,
      baaAcknowledgedBy: tenantsTable.baaAcknowledgedBy,
      hipaaEligible: tiersTable.hipaaEligible,
      engagementMode: tenantsTable.engagementMode,
      subscriptionStatus: tenantsTable.subscriptionStatus,
      billingBypass: tenantsTable.billingBypass,
    })
    .from(tenantsTable)
    .leftJoin(tiersTable, eq(tiersTable.code, tenantsTable.tierCode))
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // The phone the tenant signed up with (owner) — the only number an unpaid
  // "demo" tenant may text. Normalize to E.164 for a stable client-side compare.
  const signupPhoneRaw = await loadOwnerSignupPhone(tenantId);
  let signupPhone: string | null = null;
  if (signupPhoneRaw) {
    try {
      signupPhone = normalizePhoneE164(signupPhoneRaw) ?? signupPhoneRaw;
    } catch {
      signupPhone = signupPhoneRaw;
    }
  }
  // Always present the canonical mode to clients even if a legacy alias
  // (assisted/gated_auto) or null is still stored on the row.
  return {
    ...row,
    engagementMode: normalizeEngagementMode(row.engagementMode),
    signupPhone,
  };
}

router.get("/tenant-settings/me", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    const t = await loadTenantSettings(tenantId);
    if (!t) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    res.json(t);
  } catch (err) {
    logger.error({ err }, "Get tenant settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/tenant-settings/me", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  if (req.tenantUser!.role !== "admin" && req.tenantUser!.role !== "owner") {
    res.status(403).json({ error: "Admin or owner role required" });
    return;
  }
  const {
    name,
    quietHoursStart,
    quietHoursEnd,
    quietHoursTz,
    frequencyCapPerDay,
    requireDoubleOptIn,
    engagementMode,
  } = req.body ?? {};

  const patch: Record<string, unknown> = {};
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 128) {
      res.status(400).json({ error: "name must be a non-empty string up to 128 characters" });
      return;
    }
    patch.name = name.trim();
  }
  const validateHour = (v: unknown): number | null | undefined => {
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 23) return undefined;
    return v;
  };
  if (quietHoursStart !== undefined) {
    const v = validateHour(quietHoursStart);
    if (v === undefined) {
      res.status(400).json({ error: "quietHoursStart must be 0-23 or null" });
      return;
    }
    patch.quietHoursStart = v;
  }
  if (quietHoursEnd !== undefined) {
    const v = validateHour(quietHoursEnd);
    if (v === undefined) {
      res.status(400).json({ error: "quietHoursEnd must be 0-23 or null" });
      return;
    }
    patch.quietHoursEnd = v;
  }
  if (quietHoursTz !== undefined) {
    if (typeof quietHoursTz !== "string" || quietHoursTz.length === 0) {
      res.status(400).json({ error: "quietHoursTz must be an IANA timezone string" });
      return;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: quietHoursTz });
    } catch {
      res.status(400).json({ error: "Invalid IANA timezone" });
      return;
    }
    patch.quietHoursTz = quietHoursTz;
  }
  if (frequencyCapPerDay !== undefined) {
    if (
      typeof frequencyCapPerDay !== "number" ||
      !Number.isInteger(frequencyCapPerDay) ||
      frequencyCapPerDay < 0 ||
      frequencyCapPerDay > 1000
    ) {
      res.status(400).json({ error: "frequencyCapPerDay must be 0-1000" });
      return;
    }
    patch.frequencyCapPerDay = frequencyCapPerDay;
  }
  if (requireDoubleOptIn !== undefined) {
    if (typeof requireDoubleOptIn !== "boolean") {
      res.status(400).json({ error: "requireDoubleOptIn must be boolean" });
      return;
    }
    patch.requireDoubleOptIn = requireDoubleOptIn;
  }
  if (engagementMode !== undefined) {
    // Canonical modes are manual | copilot | autopilot. Legacy aliases
    // (assisted→copilot, gated_auto→autopilot) are still accepted and folded to
    // canonical so older clients keep working; we always persist canonical.
    const canonical =
      engagementMode === "assisted"
        ? "copilot"
        : engagementMode === "gated_auto"
          ? "autopilot"
          : engagementMode;
    if (!(ENGAGEMENT_MODES as readonly string[]).includes(canonical)) {
      res.status(400).json({
        error: "engagementMode must be one of manual, copilot, autopilot",
      });
      return;
    }
    patch.engagementMode = canonical;
  }

  if (Object.keys(patch).length === 0) {
    const cur = await loadTenantSettings(tenantId);
    res.json(cur);
    return;
  }

  try {
    const before = await loadTenantSettings(tenantId);
    await db.update(tenantsTable).set(patch).where(eq(tenantsTable.id, tenantId));
    const after = await loadTenantSettings(tenantId);
    await recordAudit(req, {
      action: "tenant.settings_updated",
      entityType: "tenant",
      entityId: tenantId,
      before,
      after,
    });
    res.json(after);
  } catch (err) {
    logger.error({ err }, "Update tenant settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tenant-settings/hipaa/acknowledge", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const userId = req.tenantUser!.tenantUserId;
  if (req.tenantUser!.role !== "admin" && req.tenantUser!.role !== "owner") {
    res.status(403).json({ error: "Admin or owner role required" });
    return;
  }
  try {
    const tier = await db
      .select({ hipaaEligible: tiersTable.hipaaEligible })
      .from(tenantsTable)
      .innerJoin(tiersTable, eq(tiersTable.code, tenantsTable.tierCode))
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    if (tier.length === 0 || !tier[0].hipaaEligible) {
      res.status(400).json({
        error: "Current plan is not HIPAA-eligible. Upgrade to a HIPAA-eligible tier first.",
      });
      return;
    }
    const now = new Date();
    const before = await loadTenantSettings(tenantId);
    await db
      .update(tenantsTable)
      .set({
        hipaaEnabled: true,
        baaAcknowledgedAt: now,
        baaAcknowledgedBy: userId,
      })
      .where(eq(tenantsTable.id, tenantId));
    const after = await loadTenantSettings(tenantId);
    setHipaaEnabled(tenantId, true);
    await recordAudit(req, {
      action: "tenant.hipaa_enabled",
      entityType: "tenant",
      entityId: tenantId,
      before,
      after,
    });
    res.json(after);
  } catch (err) {
    logger.error({ err }, "HIPAA acknowledge error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tenant-settings/hipaa/disable", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  if (req.tenantUser!.role !== "admin" && req.tenantUser!.role !== "owner") {
    res.status(403).json({ error: "Admin or owner role required" });
    return;
  }
  try {
    const before = await loadTenantSettings(tenantId);
    await db
      .update(tenantsTable)
      .set({ hipaaEnabled: false })
      .where(and(eq(tenantsTable.id, tenantId)));
    const after = await loadTenantSettings(tenantId);
    setHipaaEnabled(tenantId, false);
    await recordAudit(req, {
      action: "tenant.hipaa_disabled",
      entityType: "tenant",
      entityId: tenantId,
      before,
      after,
    });
    res.json(after);
  } catch (err) {
    logger.error({ err }, "HIPAA disable error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
