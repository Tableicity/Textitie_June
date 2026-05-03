import { Router, type IRouter } from "express";
import { sql, gte } from "drizzle-orm";
import {
  db,
  tenantsTable,
  injectionsTable,
  webhookEventsTable,
} from "@workspace/db";
import { GetStatsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stats", async (_req, res): Promise<void> => {
  const [tenantCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenantsTable);
  const [injectionCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(injectionsTable);
  const [webhookCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webhookEventsTable);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [last24Row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(injectionsTable)
    .where(gte(injectionsTable.createdAt, since));

  const tenantsByRegion = await db
    .select({
      region: tenantsTable.region,
      count: sql<number>`count(*)::int`,
    })
    .from(tenantsTable)
    .groupBy(tenantsTable.region);

  const tenantsByTier = await db
    .select({
      tierCode: tenantsTable.tierCode,
      count: sql<number>`count(*)::int`,
    })
    .from(tenantsTable)
    .groupBy(tenantsTable.tierCode);

  res.json(
    GetStatsResponse.parse({
      tenantCount: tenantCountRow?.count ?? 0,
      injectionCount: injectionCountRow?.count ?? 0,
      webhookEventCount: webhookCountRow?.count ?? 0,
      injectionsLast24h: last24Row?.count ?? 0,
      tenantsByRegion,
      tenantsByTier,
    }),
  );
});

export default router;
