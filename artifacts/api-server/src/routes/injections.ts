import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, injectionsTable } from "@workspace/db";
import {
  InjectMessageBody,
  ListInjectionsQueryParams,
  ListInjectionsResponse,
  ListInjectionsResponseItem,
} from "@workspace/api-zod";
import { dispatchInjection } from "../lib/sama";

const router: IRouter = Router();

router.post("/inject", async (req, res): Promise<void> => {
  const parsed = InjectMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { to, body, tenantId, conductorAuthorized } = parsed.data;
  const conductorAuth = conductorAuthorized ?? true;

  req.log.info(
    { to, tenantId, conductorAuth },
    "SAMA Injection: received",
  );

  const result = await dispatchInjection({
    to,
    body,
    tenantId: tenantId ?? null,
    conductorAuthorized: conductorAuth,
  });

  const [row] = await db
    .insert(injectionsTable)
    .values({
      tenantId: tenantId ?? null,
      toNumber: to,
      body,
      status: result.status,
      responseSummary: result.responseSummary,
      conductorAuthorized: conductorAuth,
    })
    .returning();

  req.log.info(
    { injectionId: row?.id, status: row?.status },
    `SAMA Injection: ${result.status === "stubbed" ? "Message Sent (STUBBED)" : `Message ${result.status}`}`,
  );

  res.status(201).json(ListInjectionsResponseItem.parse(row));
});

router.get("/injections", async (req, res): Promise<void> => {
  const query = ListInjectionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const limit = query.data.limit ?? 50;
  const rows = await db
    .select()
    .from(injectionsTable)
    .orderBy(desc(injectionsTable.createdAt))
    .limit(limit);
  res.json(ListInjectionsResponse.parse(rows));
});

export default router;
