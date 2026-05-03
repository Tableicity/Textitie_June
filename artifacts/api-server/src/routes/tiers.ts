import { Router, type IRouter } from "express";
import { db, tiersTable } from "@workspace/db";
import { ListTiersResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tiers", async (_req, res): Promise<void> => {
  const rows = await db.select().from(tiersTable).orderBy(tiersTable.id);
  res.json(ListTiersResponse.parse(rows));
});

export default router;
