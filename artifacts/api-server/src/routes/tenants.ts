import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tenantsTable } from "@workspace/db";
import {
  ListTenantsResponse,
  CreateTenantBody,
  GetTenantParams,
  GetTenantResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tenants", async (_req, res): Promise<void> => {
  const rows = await db.select().from(tenantsTable).orderBy(tenantsTable.id);
  res.json(ListTenantsResponse.parse(rows));
});

router.post("/tenants", async (req, res): Promise<void> => {
  const parsed = CreateTenantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(tenantsTable)
    .values({
      slug: parsed.data.slug,
      name: parsed.data.name,
      region: parsed.data.region,
      tierCode: parsed.data.tierCode,
      sovereignToggle: parsed.data.sovereignToggle ?? false,
      phoneNumber: parsed.data.phoneNumber ?? null,
      chatwootAccountId: parsed.data.chatwootAccountId ?? null,
      chatwootInboxId: parsed.data.chatwootInboxId ?? null,
    })
    .returning();
  req.log.info({ tenantId: row?.id, slug: row?.slug }, "Tenant created");
  res.status(201).json(GetTenantResponse.parse(row));
});

router.get("/tenants/:id", async (req, res): Promise<void> => {
  const params = GetTenantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  res.json(GetTenantResponse.parse(row));
});

export default router;
