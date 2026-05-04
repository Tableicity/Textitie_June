import { Router } from "express";
import { db, messageTemplatesTable, optOutsTable } from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";

const router = Router();

router.get("/shortcuts", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    const rows = await db
      .select()
      .from(messageTemplatesTable)
      .where(eq(messageTemplatesTable.tenantId, tenantId))
      .orderBy(asc(messageTemplatesTable.category), asc(messageTemplatesTable.name));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List shortcuts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/shortcuts", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const userId = req.tenantUser!.tenantUserId;
  const { name, shortcutKey, body, category } = req.body ?? {};

  if (!name || !shortcutKey || !body) {
    res.status(400).json({ error: "name, shortcutKey, and body are required" });
    return;
  }

  if (!shortcutKey.startsWith("/")) {
    res.status(400).json({ error: "shortcutKey must start with /" });
    return;
  }

  try {
    const existing = await db
      .select({ id: messageTemplatesTable.id })
      .from(messageTemplatesTable)
      .where(
        and(
          eq(messageTemplatesTable.tenantId, tenantId),
          eq(messageTemplatesTable.shortcutKey, shortcutKey),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: `Shortcut key "${shortcutKey}" already exists` });
      return;
    }

    const rows = await db
      .insert(messageTemplatesTable)
      .values({
        tenantId,
        name,
        shortcutKey,
        body,
        category: category || null,
        createdBy: userId,
      })
      .returning();
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Create shortcut error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/shortcuts/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  const { name, shortcutKey, body, category } = req.body ?? {};

  try {
    const existing = await db
      .select({ id: messageTemplatesTable.id })
      .from(messageTemplatesTable)
      .where(and(eq(messageTemplatesTable.id, id), eq(messageTemplatesTable.tenantId, tenantId)))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Shortcut not found" });
      return;
    }

    if (shortcutKey !== undefined && !shortcutKey.startsWith("/")) {
      res.status(400).json({ error: "shortcutKey must start with /" });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (shortcutKey !== undefined) updates.shortcutKey = shortcutKey;
    if (body !== undefined) updates.body = body;
    if (category !== undefined) updates.category = category;

    const rows = await db
      .update(messageTemplatesTable)
      .set(updates)
      .where(eq(messageTemplatesTable.id, id))
      .returning();

    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Update shortcut error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/shortcuts/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);

  try {
    const existing = await db
      .select({ id: messageTemplatesTable.id })
      .from(messageTemplatesTable)
      .where(and(eq(messageTemplatesTable.id, id), eq(messageTemplatesTable.tenantId, tenantId)))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Shortcut not found" });
      return;
    }

    await db
      .delete(messageTemplatesTable)
      .where(eq(messageTemplatesTable.id, id));

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Delete shortcut error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/opt-outs", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    const rows = await db
      .select()
      .from(optOutsTable)
      .where(eq(optOutsTable.tenantId, tenantId))
      .orderBy(desc(optOutsTable.optedOutAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List opt-outs error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/opt-outs/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);

  try {
    const existing = await db
      .select({ id: optOutsTable.id })
      .from(optOutsTable)
      .where(and(eq(optOutsTable.id, id), eq(optOutsTable.tenantId, tenantId)))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Opt-out record not found" });
      return;
    }

    await db
      .delete(optOutsTable)
      .where(eq(optOutsTable.id, id));

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Delete opt-out error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
