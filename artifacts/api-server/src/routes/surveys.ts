import { Router } from "express";
import {
  db,
  surveysTable,
  surveySendsTable,
  surveyResponsesTable,
  conversationsTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";
import { recordAudit } from "../lib/audit";

const router = Router();

const DEFAULT_PROMPT = "How would you rate your experience? Please tap the link to leave a rating:";
const DEFAULT_THANKS = "Thanks for your feedback!";

async function getOrCreateSurvey(tenantId: number) {
  const existing = await db
    .select()
    .from(surveysTable)
    .where(and(eq(surveysTable.tenantId, tenantId), eq(surveysTable.type, "csat")))
    .limit(1);
  if (existing.length > 0) return existing[0];
  const inserted = await db
    .insert(surveysTable)
    .values({ tenantId, type: "csat", enabled: false })
    .onConflictDoNothing({ target: [surveysTable.tenantId, surveysTable.type] })
    .returning();
  if (inserted.length > 0) return inserted[0];
  const refetch = await db
    .select()
    .from(surveysTable)
    .where(and(eq(surveysTable.tenantId, tenantId), eq(surveysTable.type, "csat")))
    .limit(1);
  return refetch[0];
}

router.get("/surveys", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    const survey = await getOrCreateSurvey(tenantId);
    res.json(survey);
  } catch (err) {
    logger.error({ err }, "Get survey error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/surveys", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const role = req.tenantUser!.role;
  if (role !== "admin" && role !== "owner") {
    res.status(403).json({ error: "Admin or owner role required" });
    return;
  }
  const { enabled, prompt, thankYou, sendAfterClose, sendDelayMinutes } = req.body ?? {};
  try {
    const before = await getOrCreateSurvey(tenantId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof enabled === "boolean") patch.enabled = enabled;
    if (typeof prompt === "string") patch.prompt = prompt.trim() || DEFAULT_PROMPT;
    if (typeof thankYou === "string") patch.thankYou = thankYou.trim() || DEFAULT_THANKS;
    if (typeof sendAfterClose === "boolean") patch.sendAfterClose = sendAfterClose;
    if (typeof sendDelayMinutes === "number" && Number.isFinite(sendDelayMinutes)) {
      const v = Math.max(0, Math.min(60, Math.floor(sendDelayMinutes)));
      patch.sendDelayMinutes = v;
    }
    const updated = await db
      .update(surveysTable)
      .set(patch)
      .where(and(eq(surveysTable.tenantId, tenantId), eq(surveysTable.type, "csat")))
      .returning();
    await recordAudit(req, {
      action: "survey.updated",
      entityType: "survey",
      entityId: before.id,
      before: { enabled: before.enabled, sendAfterClose: before.sendAfterClose },
      after: { enabled: updated[0].enabled, sendAfterClose: updated[0].sendAfterClose },
    });
    res.json(updated[0]);
  } catch (err) {
    logger.error({ err }, "Update survey error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/surveys/responses", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
  const offsetRaw = Number(req.query.offset);
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

  try {
    const conds = [eq(surveyResponsesTable.tenantId, tenantId)];
    if (from && !Number.isNaN(from.getTime())) conds.push(gte(surveyResponsesTable.respondedAt, from));
    if (to && !Number.isNaN(to.getTime())) conds.push(lte(surveyResponsesTable.respondedAt, to));

    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: surveyResponsesTable.id,
          score: surveyResponsesTable.score,
          comment: surveyResponsesTable.comment,
          respondedAt: surveyResponsesTable.respondedAt,
          contactPhone: surveySendsTable.contactPhone,
          conversationId: surveySendsTable.conversationId,
          contactName: conversationsTable.contactName,
        })
        .from(surveyResponsesTable)
        .innerJoin(surveySendsTable, eq(surveyResponsesTable.sendId, surveySendsTable.id))
        .leftJoin(conversationsTable, eq(surveySendsTable.conversationId, conversationsTable.id))
        .where(and(...conds))
        .orderBy(desc(surveyResponsesTable.respondedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(surveyResponsesTable)
        .where(and(...conds)),
    ]);
    res.json({ items: rows, total: totalRows[0]?.c ?? 0, limit, offset });
  } catch (err) {
    logger.error({ err }, "List survey responses error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/surveys/sends", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
  try {
    const rows = await db
      .select({
        id: surveySendsTable.id,
        contactPhone: surveySendsTable.contactPhone,
        conversationId: surveySendsTable.conversationId,
        status: surveySendsTable.status,
        sentAt: surveySendsTable.sentAt,
        expiresAt: surveySendsTable.expiresAt,
        error: surveySendsTable.error,
        createdAt: surveySendsTable.createdAt,
      })
      .from(surveySendsTable)
      .where(eq(surveySendsTable.tenantId, tenantId))
      .orderBy(desc(surveySendsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List survey sends error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/csat", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const toRaw = typeof req.query.to === "string" ? req.query.to : null;
  const fromRaw = typeof req.query.from === "string" ? req.query.from : null;
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    res.status(400).json({ error: "Invalid from/to" });
    return;
  }
  try {
    const overallRow = await db
      .select({
        count: sql<number>`count(*)::int`,
        avg: sql<number | null>`avg(${surveyResponsesTable.score})::float`,
      })
      .from(surveyResponsesTable)
      .where(
        and(
          eq(surveyResponsesTable.tenantId, tenantId),
          gte(surveyResponsesTable.respondedAt, from),
          lte(surveyResponsesTable.respondedAt, to),
        ),
      );

    // Count only sends that were actually dispatched — pending/failed
    // shouldn't deflate the response rate.
    const sentRow = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(surveySendsTable)
      .where(
        and(
          eq(surveySendsTable.tenantId, tenantId),
          gte(surveySendsTable.createdAt, from),
          lte(surveySendsTable.createdAt, to),
          inArray(surveySendsTable.status, ["sent", "responded", "expired"]),
        ),
      );

    const daily = await db
      .select({
        date: sql<string>`to_char(${surveyResponsesTable.respondedAt}, 'YYYY-MM-DD')`,
        avg: sql<number | null>`avg(${surveyResponsesTable.score})::float`,
        count: sql<number>`count(*)::int`,
      })
      .from(surveyResponsesTable)
      .where(
        and(
          eq(surveyResponsesTable.tenantId, tenantId),
          gte(surveyResponsesTable.respondedAt, from),
          lte(surveyResponsesTable.respondedAt, to),
        ),
      )
      .groupBy(sql`to_char(${surveyResponsesTable.respondedAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${surveyResponsesTable.respondedAt}, 'YYYY-MM-DD')`);

    const sent = sentRow[0]?.count ?? 0;
    const responded = overallRow[0]?.count ?? 0;
    const avg = overallRow[0]?.avg ?? null;
    const responseRate = sent > 0 ? responded / sent : 0;
    res.json({
      avg: avg !== null ? Math.round(avg * 100) / 100 : null,
      count: responded,
      sentCount: sent,
      responseRate: Math.round(responseRate * 1000) / 1000,
      dailyAvg: daily.map((d) => ({
        date: d.date,
        avg: d.avg !== null ? Math.round(d.avg * 100) / 100 : null,
        count: d.count,
      })),
    });
  } catch (err) {
    logger.error({ err }, "CSAT analytics error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
