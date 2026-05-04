import { Router } from "express";
import { db, automationRulesTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";

const router = Router();

router.get("/automations", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    const rows = await db
      .select()
      .from(automationRulesTable)
      .where(eq(automationRulesTable.tenantId, tenantId))
      .orderBy(asc(automationRulesTable.priority), asc(automationRulesTable.createdAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List automations error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/automations", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { type, name, enabled, triggerConfig, actionConfig, priority } = req.body ?? {};

  if (!type || !name) {
    res.status(400).json({ error: "type and name are required" });
    return;
  }

  const validTypes = ["keyword_reply", "follow_up_timer", "auto_resolve", "welcome_message", "auto_unsubscribe"];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
    return;
  }

  try {
    const rows = await db
      .insert(automationRulesTable)
      .values({
        tenantId,
        type,
        name,
        enabled: enabled ?? true,
        triggerConfig: triggerConfig ?? {},
        actionConfig: actionConfig ?? {},
        priority: priority ?? 0,
      })
      .returning();
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Create automation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/automations/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  const { name, enabled, triggerConfig, actionConfig, priority } = req.body ?? {};

  try {
    const existing = await db
      .select({ id: automationRulesTable.id })
      .from(automationRulesTable)
      .where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.tenantId, tenantId)))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Automation rule not found" });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (enabled !== undefined) updates.enabled = enabled;
    if (triggerConfig !== undefined) updates.triggerConfig = triggerConfig;
    if (actionConfig !== undefined) updates.actionConfig = actionConfig;
    if (priority !== undefined) updates.priority = priority;

    const rows = await db
      .update(automationRulesTable)
      .set(updates)
      .where(eq(automationRulesTable.id, id))
      .returning();

    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Update automation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/automations/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);

  try {
    const existing = await db
      .select({ id: automationRulesTable.id })
      .from(automationRulesTable)
      .where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.tenantId, tenantId)))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Automation rule not found" });
      return;
    }

    await db
      .delete(automationRulesTable)
      .where(eq(automationRulesTable.id, id));

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Delete automation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
