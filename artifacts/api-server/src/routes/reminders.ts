import { Router } from "express";
import { db, remindersTable, conversationsTable } from "@workspace/db";
import { and, eq, asc, isNull, isNotNull, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";

const router = Router();

router.get("/reminders", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const userId = req.tenantUser!.tenantUserId;
  const status = typeof req.query.status === "string" ? req.query.status : "all";

  try {
    const conditions = [
      eq(remindersTable.tenantId, tenantId),
      eq(remindersTable.userId, userId),
      isNull(remindersTable.dismissedAt),
    ];
    // Filter by status in SQL (not in-memory after a LIMIT) so a backlog of
    // future reminders can never push the due ones out of the result window.
    if (status === "due") {
      conditions.push(isNotNull(remindersTable.firedAt));
    } else if (status === "pending") {
      conditions.push(isNull(remindersTable.firedAt));
    }

    const rows = await db
      .select({
        id: remindersTable.id,
        tenantId: remindersTable.tenantId,
        conversationId: remindersTable.conversationId,
        userId: remindersTable.userId,
        remindAt: remindersTable.remindAt,
        note: remindersTable.note,
        firedAt: remindersTable.firedAt,
        dismissedAt: remindersTable.dismissedAt,
        createdAt: remindersTable.createdAt,
        contactPhone: conversationsTable.contactPhone,
        contactName: conversationsTable.contactName,
      })
      .from(remindersTable)
      .innerJoin(conversationsTable, eq(remindersTable.conversationId, conversationsTable.id))
      .where(and(...conditions))
      .orderBy(asc(remindersTable.remindAt))
      .limit(100);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List reminders error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reminders", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const userId = req.tenantUser!.tenantUserId;
  const { conversationId, remindAt, note } = req.body ?? {};

  if (!conversationId || typeof conversationId !== "number") {
    res.status(400).json({ error: "conversationId is required" });
    return;
  }
  if (!remindAt || typeof remindAt !== "string") {
    res.status(400).json({ error: "remindAt (ISO timestamp) is required" });
    return;
  }
  const when = new Date(remindAt);
  if (Number.isNaN(when.getTime())) {
    res.status(400).json({ error: "remindAt must be a valid ISO timestamp" });
    return;
  }
  if (when.getTime() < Date.now() - 60_000) {
    res.status(400).json({ error: "remindAt must be in the future" });
    return;
  }

  try {
    const conv = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.isQuarantined, false)))
      .limit(1);
    if (conv.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const rows = await db
      .insert(remindersTable)
      .values({
        tenantId,
        conversationId,
        userId,
        remindAt: when,
        note: typeof note === "string" && note.trim().length > 0 ? note.trim() : null,
      })
      .returning();
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Create reminder error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/reminders/:id/dismiss", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const userId = req.tenantUser!.tenantUserId;
  const id = Number(req.params.id);
  try {
    const rows = await db
      .update(remindersTable)
      .set({ dismissedAt: new Date() })
      .where(and(eq(remindersTable.id, id), eq(remindersTable.tenantId, tenantId), eq(remindersTable.userId, userId)))
      .returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "Reminder not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Dismiss reminder error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/reminders/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const userId = req.tenantUser!.tenantUserId;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid reminder id" });
    return;
  }

  const { remindAt, note } = req.body ?? {};
  const hasRemindAt = remindAt !== undefined;
  const hasNote = note !== undefined;
  if (!hasRemindAt && !hasNote) {
    res.status(400).json({ error: "Provide remindAt and/or note to update" });
    return;
  }

  const update: { remindAt?: Date; firedAt?: null; note?: string | null } = {};

  if (hasRemindAt) {
    if (typeof remindAt !== "string") {
      res.status(400).json({ error: "remindAt must be an ISO timestamp" });
      return;
    }
    const when = new Date(remindAt);
    if (Number.isNaN(when.getTime())) {
      res.status(400).json({ error: "remindAt must be a valid ISO timestamp" });
      return;
    }
    if (when.getTime() < Date.now() - 60_000) {
      res.status(400).json({ error: "remindAt must be in the future" });
      return;
    }
    update.remindAt = when;
    // Re-arm: moving the time forward clears the fired flag so it surfaces
    // again when due (this is the snooze path).
    update.firedAt = null;
  }

  if (hasNote) {
    if (note === null) {
      update.note = null;
    } else if (typeof note === "string") {
      update.note = note.trim().length > 0 ? note.trim() : null;
    } else {
      res.status(400).json({ error: "note must be a string or null" });
      return;
    }
  }

  try {
    const rows = await db
      .update(remindersTable)
      .set(update)
      .where(
        and(
          eq(remindersTable.id, id),
          eq(remindersTable.tenantId, tenantId),
          eq(remindersTable.userId, userId),
          isNull(remindersTable.dismissedAt),
        ),
      )
      .returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "Reminder not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Update reminder error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/reminders/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const userId = req.tenantUser!.tenantUserId;
  const id = Number(req.params.id);
  try {
    const rows = await db
      .delete(remindersTable)
      .where(and(eq(remindersTable.id, id), eq(remindersTable.tenantId, tenantId), eq(remindersTable.userId, userId)))
      .returning({ id: remindersTable.id });
    if (rows.length === 0) {
      res.status(404).json({ error: "Reminder not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Delete reminder error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Called by the timer engine — marks all reminders whose remindAt has passed as fired. */
export async function processDueReminders(): Promise<number> {
  try {
    const now = new Date();
    const updated = await db
      .update(remindersTable)
      .set({ firedAt: now })
      .where(and(isNull(remindersTable.firedAt), lte(remindersTable.remindAt, now), isNull(remindersTable.dismissedAt)))
      .returning({ id: remindersTable.id });
    return updated.length;
  } catch (err) {
    logger.error({ err }, "processDueReminders failed");
    return 0;
  }
}

// Keep the sql import "used" without bundlers complaining (used in the future tag-distinct query).
void sql;

export default router;
