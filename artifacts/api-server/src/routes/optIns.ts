import { Router } from "express";
import { db, optInsTable } from "@workspace/db";
import { and, eq, desc, ilike } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";
import { recordAudit } from "../lib/audit";

const router = Router();

const VALID_SOURCES = new Set(["web_form", "keyword", "agent_collected", "imported"]);

router.get("/opt-ins", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const phone = typeof req.query.phone === "string" ? req.query.phone.trim() : "";
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 100;

  try {
    const conds = [eq(optInsTable.tenantId, tenantId)];
    if (phone) conds.push(ilike(optInsTable.phone, `%${phone}%`));
    const rows = await db
      .select()
      .from(optInsTable)
      .where(and(...conds))
      .orderBy(desc(optInsTable.consentedAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List opt-ins error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/opt-ins", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { phone, source, evidenceUrl, note } = req.body ?? {};
  if (!phone || typeof phone !== "string") {
    res.status(400).json({ error: "phone is required" });
    return;
  }
  if (!source || typeof source !== "string" || !VALID_SOURCES.has(source)) {
    res.status(400).json({ error: `source must be one of: ${[...VALID_SOURCES].join(", ")}` });
    return;
  }
  try {
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;

    const inserted = await db
      .insert(optInsTable)
      .values({
        tenantId,
        phone: phone.trim(),
        source,
        ip,
        userAgent,
        evidenceUrl: typeof evidenceUrl === "string" ? evidenceUrl : null,
        note: typeof note === "string" ? note : null,
      })
      .onConflictDoUpdate({
        target: [optInsTable.tenantId, optInsTable.phone],
        set: {
          source,
          consentedAt: new Date(),
          revokedAt: null,
          ip,
          userAgent,
          evidenceUrl: typeof evidenceUrl === "string" ? evidenceUrl : null,
          note: typeof note === "string" ? note : null,
        },
      })
      .returning();
    await recordAudit(req, {
      action: "opt_in.recorded",
      entityType: "opt_in",
      entityId: inserted[0].id,
      after: { phone: inserted[0].phone, source },
    });
    res.status(201).json(inserted[0]);
  } catch (err) {
    logger.error({ err }, "Create opt-in error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/opt-ins/:id/revoke", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  try {
    const rows = await db
      .update(optInsTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(optInsTable.id, id), eq(optInsTable.tenantId, tenantId)))
      .returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "Opt-in not found" });
      return;
    }
    await recordAudit(req, {
      action: "opt_in.revoked",
      entityType: "opt_in",
      entityId: id,
      after: { phone: rows[0].phone },
    });
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Revoke opt-in error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/opt-ins/lookup", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const phone = typeof req.query.phone === "string" ? req.query.phone.trim() : "";
  if (!phone) {
    res.status(400).json({ error: "phone query param required" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(optInsTable)
      .where(and(eq(optInsTable.tenantId, tenantId), eq(optInsTable.phone, phone)))
      .limit(1);
    res.json(rows[0] ?? null);
  } catch (err) {
    logger.error({ err }, "Lookup opt-in error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
