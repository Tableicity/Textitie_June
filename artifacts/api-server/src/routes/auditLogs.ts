import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";

const router = Router();

router.get("/audit-logs", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : "";
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : "";
  const action = typeof req.query.action === "string" ? req.query.action : "";
  const actorRaw = Number(req.query.actorUserId);
  const actorUserId = Number.isFinite(actorRaw) && actorRaw > 0 ? actorRaw : null;
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
  const offsetRaw = Number(req.query.offset);
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  try {
    const conds = [eq(auditLogsTable.tenantId, tenantId)];
    if (entityType) conds.push(eq(auditLogsTable.entityType, entityType));
    if (entityId) conds.push(eq(auditLogsTable.entityId, entityId));
    if (action) conds.push(eq(auditLogsTable.action, action));
    if (actorUserId) conds.push(eq(auditLogsTable.actorUserId, actorUserId));
    if (from && !Number.isNaN(from.getTime())) conds.push(gte(auditLogsTable.createdAt, from));
    if (to && !Number.isNaN(to.getTime())) conds.push(lte(auditLogsTable.createdAt, to));

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(auditLogsTable)
        .where(and(...conds))
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(auditLogsTable)
        .where(and(...conds)),
    ]);
    res.json({ items: rows, total: totalRows[0]?.c ?? 0, limit, offset });
  } catch (err) {
    logger.error({ err }, "List audit logs error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
