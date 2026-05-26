import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import multer from "multer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { db, tenantsTable } from "@workspace/db";
import {
  ListTenantsResponse,
  CreateTenantBody,
  GetTenantParams,
  GetTenantResponse,
  UpdateTenantBody,
  UpdateTenantParams,
  UpdateTenantResponse,
} from "@workspace/api-zod";
import { provisionChatwootInbox } from "../lib/chatwoot";
import { requireTenantAuth } from "../middleware/tenantAuth";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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

  let chatwootAccountId = parsed.data.chatwootAccountId ?? null;
  let chatwootInboxId = parsed.data.chatwootInboxId ?? null;

  if (!chatwootAccountId && !chatwootInboxId) {
    const provision = await provisionChatwootInbox(parsed.data.name);
    if (provision.status === "created") {
      chatwootAccountId = provision.accountId;
      chatwootInboxId = provision.inboxId;
      req.log.info(
        { inboxId: chatwootInboxId, accountId: chatwootAccountId },
        "Auto-provisioned Chatwoot inbox",
      );
    } else {
      req.log.info(
        { provisionStatus: provision.status, detail: provision.detail },
        "Chatwoot auto-provision skipped",
      );
    }
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
      chatwootAccountId,
      chatwootInboxId,
      knowledgeBase: parsed.data.knowledgeBase ?? null,
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

router.patch("/tenants/:id", async (req, res): Promise<void> => {
  const params = UpdateTenantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateTenantBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  // Server-side E.164 guard: an invalid phone here would silently break
  // resolveTenantByPhoneNumber() and inbound texts would never route.
  if (
    "phoneNumber" in body.data &&
    body.data.phoneNumber !== null &&
    body.data.phoneNumber !== undefined &&
    body.data.phoneNumber !== "" &&
    !/^\+[1-9]\d{6,14}$/.test(body.data.phoneNumber)
  ) {
    res
      .status(400)
      .json({ error: "phoneNumber must be E.164 format, e.g. +19094904265" });
    return;
  }
  const patch: Record<string, unknown> = {};
  for (const k of [
    "name",
    "region",
    "tierCode",
    "sovereignToggle",
    "phoneNumber",
    "chatwootAccountId",
    "chatwootInboxId",
    "knowledgeBase",
  ] as const) {
    if (k in body.data) patch[k] = body.data[k];
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [row] = await db
    .update(tenantsTable)
    .set(patch)
    .where(eq(tenantsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  req.log.info(
    { tenantId: row.id, fields: Object.keys(patch) },
    "Tenant patched",
  );
  res.json(UpdateTenantResponse.parse(row));
});

router.post(
  "/tenants/:id/knowledge-upload",
  requireTenantAuth,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: "File too large. Maximum size is 5MB." });
          return;
        }
        res.status(400).json({ error: `Upload error: ${err.message}` });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    // Tenant-scoped: a tenant user may only upload to their own tenant.
    if (!req.tenantUser || req.tenantUser.tenantId !== id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const ext = file.originalname.split(".").pop()?.toLowerCase();
    let extractedText = "";

    if (ext === "pdf") {
      try {
        const data = new Uint8Array(file.buffer);
        const doc = await getDocument({ data, useSystemFonts: true }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          const text = content.items
            .filter((item: any) => "str" in item)
            .map((item: any) => item.str)
            .join(" ");
          if (text.trim()) pages.push(text.trim());
        }
        extractedText = pages.join("\n\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.error({ err: msg }, "PDF parse failed");
        res.status(400).json({ error: `Failed to parse PDF: ${msg}` });
        return;
      }
    } else if (ext === "txt" || ext === "md" || ext === "csv") {
      extractedText = file.buffer.toString("utf-8").trim();
    } else {
      res
        .status(400)
        .json({ error: `Unsupported file type: .${ext}. Use PDF, TXT, MD, or CSV.` });
      return;
    }

    if (!extractedText) {
      res.status(400).json({ error: "No text content extracted from file" });
      return;
    }

    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, id));
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const separator = "\n\n--- Uploaded from: " + file.originalname + " ---\n\n";
    const newKb = (tenant.knowledgeBase ?? "") + separator + extractedText;

    const [updated] = await db
      .update(tenantsTable)
      .set({ knowledgeBase: newKb })
      .where(eq(tenantsTable.id, id))
      .returning();

    req.log.info(
      {
        tenantId: id,
        fileName: file.originalname,
        extractedChars: extractedText.length,
      },
      "Knowledge base file uploaded",
    );

    res.json({
      success: true,
      fileName: file.originalname,
      extractedChars: extractedText.length,
      totalKbChars: updated?.knowledgeBase?.length ?? 0,
    });
  },
);

export default router;
