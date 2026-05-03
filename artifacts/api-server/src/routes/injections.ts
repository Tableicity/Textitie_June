import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, injectionsTable, tenantsTable } from "@workspace/db";
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

  let tenant = null;
  if (tenantId != null) {
    const [row] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId));
    if (!row) {
      res.status(400).json({ error: `Tenant ${tenantId} not found` });
      return;
    }
    tenant = row;
  }

  req.log.info(
    {
      to,
      tenantId: tenant?.id ?? null,
      tenantSlug: tenant?.slug ?? null,
      from: tenant?.phoneNumber ?? null,
      conductorAuth,
    },
    "SAMA Injection: received",
  );

  const { send, whisper } = await dispatchInjection({
    to,
    body,
    tenant,
    conductorAuthorized: conductorAuth,
  });

  const summary =
    whisper && whisper.status !== "stubbed"
      ? `${send.responseSummary ?? ""} | whisper=${whisper.status} ${whisper.detail}`
      : send.responseSummary;

  const [row] = await db
    .insert(injectionsTable)
    .values({
      tenantId: tenant?.id ?? null,
      toNumber: to,
      body,
      status: send.status,
      responseSummary: summary,
      conductorAuthorized: conductorAuth,
    })
    .returning();

  req.log.info(
    {
      injectionId: row?.id,
      status: row?.status,
      tenantSlug: tenant?.slug ?? null,
      whisperStatus: whisper?.status ?? null,
    },
    `SAMA Injection: ${send.status === "stubbed" ? "Message Sent (STUBBED)" : `Message ${send.status}`}`,
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
