import { Router } from "express";
import { db, dispositionsTable } from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";

const router = Router();

router.get("/dispositions", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    const rows = await db
      .select()
      .from(dispositionsTable)
      .where(eq(dispositionsTable.tenantId, tenantId))
      .orderBy(asc(dispositionsTable.archived), asc(dispositionsTable.sortOrder), asc(dispositionsTable.label));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List dispositions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/dispositions", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { label, color, sortOrder } = req.body ?? {};
  if (!label || typeof label !== "string" || label.trim().length === 0) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (label.length > 80) {
    res.status(400).json({ error: "label must be 80 characters or fewer" });
    return;
  }
  const safeColor = typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#64748b";
  try {
    const rows = await db
      .insert(dispositionsTable)
      .values({
        tenantId,
        label: label.trim(),
        color: safeColor,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
      })
      .returning();
    res.status(201).json(rows[0]);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      res.status(409).json({ error: "A disposition with this label already exists" });
      return;
    }
    logger.error({ err }, "Create disposition error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/dispositions/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  const { label, color, sortOrder, archived } = req.body ?? {};
  const patch: Partial<typeof dispositionsTable.$inferInsert> = {};
  if (typeof label === "string" && label.trim().length > 0 && label.length <= 80) patch.label = label.trim();
  if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) patch.color = color;
  if (typeof sortOrder === "number") patch.sortOrder = sortOrder;
  if (typeof archived === "boolean") patch.archived = archived;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  try {
    const rows = await db
      .update(dispositionsTable)
      .set(patch)
      .where(and(eq(dispositionsTable.id, id), eq(dispositionsTable.tenantId, tenantId)))
      .returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "Disposition not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Update disposition error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/dispositions/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  try {
    const rows = await db
      .update(dispositionsTable)
      .set({ archived: true })
      .where(and(eq(dispositionsTable.id, id), eq(dispositionsTable.tenantId, tenantId)))
      .returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "Disposition not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Archive disposition error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
