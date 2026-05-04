import { Router } from "express";
import { db, conversationsTable, messagesTable, departmentsTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";

const router = Router();

router.get("/conversations", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;

  try {
    const conditions = [eq(conversationsTable.tenantId, tenantId)];
    if (departmentId !== undefined) {
      if (departmentId === 0) {
        conditions.push(isNull(conversationsTable.departmentId));
      } else {
        conditions.push(eq(conversationsTable.departmentId, departmentId));
      }
    }

    const rows = await db
      .select({
        id: conversationsTable.id,
        tenantId: conversationsTable.tenantId,
        departmentId: conversationsTable.departmentId,
        contactPhone: conversationsTable.contactPhone,
        contactName: conversationsTable.contactName,
        status: conversationsTable.status,
        assignedUserId: conversationsTable.assignedUserId,
        lastMessageAt: conversationsTable.lastMessageAt,
        createdAt: conversationsTable.createdAt,
      })
      .from(conversationsTable)
      .where(and(...conditions))
      .orderBy(desc(conversationsTable.lastMessageAt));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List conversations error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/conversations/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);

  try {
    const rows = await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.id, id),
          eq(conversationsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Get conversation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/conversations/:id/messages",
  requireTenantAuth,
  async (req, res) => {
    const tenantId = req.tenantUser!.tenantId;
    const conversationId = Number(req.params.id);

    try {
      const convRows = await db
        .select({ id: conversationsTable.id })
        .from(conversationsTable)
        .where(
          and(
            eq(conversationsTable.id, conversationId),
            eq(conversationsTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (convRows.length === 0) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      const messages = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, conversationId))
        .orderBy(messagesTable.createdAt);

      res.json(messages);
    } catch (err) {
      logger.error({ err }, "List messages error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.post(
  "/conversations/:id/messages",
  requireTenantAuth,
  async (req, res) => {
    const tenantId = req.tenantUser!.tenantId;
    const conversationId = Number(req.params.id);
    const { body } = req.body ?? {};

    if (!body || typeof body !== "string" || body.trim().length === 0) {
      res.status(400).json({ error: "Message body required" });
      return;
    }

    try {
      const convRows = await db
        .select({ id: conversationsTable.id })
        .from(conversationsTable)
        .where(
          and(
            eq(conversationsTable.id, conversationId),
            eq(conversationsTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (convRows.length === 0) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      const now = new Date();
      const rows = await db
        .insert(messagesTable)
        .values({
          conversationId,
          direction: "outbound",
          body: body.trim(),
          senderName: req.tenantUser!.email,
          read: true,
        })
        .returning();

      await db
        .update(conversationsTable)
        .set({ lastMessageAt: now })
        .where(eq(conversationsTable.id, conversationId));

      res.status(201).json(rows[0]);
    } catch (err) {
      logger.error({ err }, "Send message error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
