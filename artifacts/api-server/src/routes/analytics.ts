import { Router } from "express";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";
import {
  getOverview,
  getVolume,
  getAgentKpis,
  getDepartmentKpis,
  getConversationExport,
  toCsv,
} from "../lib/analytics";

const router: Router = Router();

const MAX_RANGE_DAYS = 366;

function parseRange(req: { query: Record<string, unknown> }): { from: Date; to: Date } | { error: string } {
  const toRaw = typeof req.query.to === "string" ? req.query.to : null;
  const fromRaw = typeof req.query.from === "string" ? req.query.from : null;
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "Invalid from/to (expected ISO timestamps)" };
  }
  if (to.getTime() < from.getTime()) {
    return { error: "to must be >= from" };
  }
  const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  if (days > MAX_RANGE_DAYS) {
    return { error: `Range too large (max ${MAX_RANGE_DAYS} days)` };
  }
  return { from, to };
}

router.get("/analytics/overview", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const range = parseRange(req);
  if ("error" in range) {
    res.status(400).json({ error: range.error });
    return;
  }
  try {
    const data = await getOverview({ tenantId, ...range });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Analytics overview error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/volume", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const range = parseRange(req);
  if ("error" in range) {
    res.status(400).json({ error: range.error });
    return;
  }
  try {
    const points = await getVolume({ tenantId, ...range });
    res.json(points);
  } catch (err) {
    logger.error({ err }, "Analytics volume error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/agents", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const range = parseRange(req);
  if ("error" in range) {
    res.status(400).json({ error: range.error });
    return;
  }
  try {
    const data = await getAgentKpis({ tenantId, ...range });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Analytics agents error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/departments", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const range = parseRange(req);
  if ("error" in range) {
    res.status(400).json({ error: range.error });
    return;
  }
  try {
    const data = await getDepartmentKpis({ tenantId, ...range });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Analytics departments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/export", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const range = parseRange(req);
  if ("error" in range) {
    res.status(400).json({ error: range.error });
    return;
  }
  try {
    const rows = await getConversationExport({ tenantId, ...range });
    const csv = toCsv(rows);
    const fromStr = range.from.toISOString().slice(0, 10);
    const toStr = range.to.toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="conversations_${fromStr}_${toStr}.csv"`,
    );
    res.send(csv);
  } catch (err) {
    logger.error({ err }, "Analytics export error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
