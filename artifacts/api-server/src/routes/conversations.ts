import { Router } from "express";
import { db, conversationsTable, messagesTable, departmentsTable, conversationEventsTable, tenantUsersTable, dispositionsTable } from "@workspace/db";
import { eq, and, desc, isNull, ilike, or, gte, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";
import { pickAgent } from "../lib/routing";
import type { RoutingStrategy } from "../lib/routing";
import { recordMessageUsage } from "../lib/stripe-stub";

const router = Router();

router.get("/conversations", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const assignedUserId = req.query.assignedUserId ? Number(req.query.assignedUserId) : undefined;
  const fromStr = typeof req.query.from === "string" ? req.query.from : "";
  const toStr = typeof req.query.to === "string" ? req.query.to : "";

  try {
    const conditions = [eq(conversationsTable.tenantId, tenantId)];
    if (departmentId !== undefined) {
      if (departmentId === 0) {
        conditions.push(isNull(conversationsTable.departmentId));
      } else {
        conditions.push(eq(conversationsTable.departmentId, departmentId));
      }
    }
    if (status === "open" || status === "closed") {
      conditions.push(eq(conversationsTable.status, status));
    }
    if (assignedUserId !== undefined && Number.isFinite(assignedUserId)) {
      if (assignedUserId === 0) {
        conditions.push(isNull(conversationsTable.assignedUserId));
      } else {
        conditions.push(eq(conversationsTable.assignedUserId, assignedUserId));
      }
    }
    if (fromStr) {
      const d = new Date(fromStr);
      if (!Number.isNaN(d.getTime())) conditions.push(gte(conversationsTable.createdAt, d));
    }
    if (toStr) {
      const d = new Date(toStr);
      if (!Number.isNaN(d.getTime())) conditions.push(lte(conversationsTable.createdAt, d));
    }
    if (q.length > 0) {
      const pat = `%${q}%`;
      const orExpr = or(
        ilike(conversationsTable.contactName, pat),
        ilike(conversationsTable.contactPhone, pat),
        sql`EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = ${conversationsTable.id} AND m.body ILIKE ${pat})`,
      );
      if (orExpr) conditions.push(orExpr);
    }

    const rows = await db
      .select({
        id: conversationsTable.id,
        tenantId: conversationsTable.tenantId,
        departmentId: conversationsTable.departmentId,
        contactId: conversationsTable.contactId,
        contactPhone: conversationsTable.contactPhone,
        contactName: conversationsTable.contactName,
        status: conversationsTable.status,
        dispositionId: conversationsTable.dispositionId,
        resolutionNote: conversationsTable.resolutionNote,
        tags: conversationsTable.tags,
        assignedUserId: conversationsTable.assignedUserId,
        assignedAt: conversationsTable.assignedAt,
        lastMessageAt: conversationsTable.lastMessageAt,
        createdAt: conversationsTable.createdAt,
      })
      .from(conversationsTable)
      .where(and(...conditions))
      .orderBy(desc(conversationsTable.lastMessageAt))
      .limit(500);

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
  "/conversations/:id/whisper",
  requireTenantAuth,
  async (req, res) => {
    const tenantId = req.tenantUser!.tenantId;
    const conversationId = Number(req.params.id);
    const { body } = req.body ?? {};

    if (!body || typeof body !== "string" || body.trim().length === 0) {
      res.status(400).json({ error: "Whisper body required" });
      return;
    }
    if (body.length > 5000) {
      res.status(400).json({ error: "Whisper body too long (max 5000 chars)" });
      return;
    }

    try {
      const conv = await db
        .select({ id: conversationsTable.id })
        .from(conversationsTable)
        .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.tenantId, tenantId)))
        .limit(1);
      if (conv.length === 0) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      const rows = await db
        .insert(messagesTable)
        .values({
          conversationId,
          direction: "internal",
          body: body.trim(),
          senderName: req.tenantUser!.email,
          read: true,
        })
        .returning();
      // Whispers do not bump lastMessageAt — they're agent-only chatter.
      res.status(201).json(rows[0]);
    } catch (err) {
      logger.error({ err }, "Whisper error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.patch("/conversations/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const actorId = req.tenantUser!.tenantUserId;
  const id = Number(req.params.id);
  const { status, dispositionId, resolutionNote } = req.body ?? {};

  if (status !== undefined && status !== "open" && status !== "closed") {
    res.status(400).json({ error: "status must be 'open' or 'closed'" });
    return;
  }

  try {
    const conv = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.tenantId, tenantId)))
      .limit(1);
    if (conv.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const patch: Partial<typeof conversationsTable.$inferInsert> = {};
    if (status !== undefined) patch.status = status;
    if (dispositionId !== undefined) {
      if (dispositionId === null) {
        patch.dispositionId = null;
      } else if (typeof dispositionId === "number") {
        const disp = await db
          .select({ id: dispositionsTable.id })
          .from(dispositionsTable)
          .where(and(eq(dispositionsTable.id, dispositionId), eq(dispositionsTable.tenantId, tenantId)))
          .limit(1);
        if (disp.length === 0) {
          res.status(400).json({ error: "Invalid dispositionId" });
          return;
        }
        patch.dispositionId = dispositionId;
      }
    }
    if (resolutionNote !== undefined) {
      patch.resolutionNote = typeof resolutionNote === "string" ? resolutionNote : null;
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    const updated = await db
      .update(conversationsTable)
      .set(patch)
      .where(eq(conversationsTable.id, id))
      .returning();

    if (status === "closed" && conv[0].status !== "closed") {
      await db.insert(conversationEventsTable).values({
        conversationId: id,
        eventType: "resolved",
        actorId,
        metadata: JSON.stringify({
          dispositionId: patch.dispositionId ?? conv[0].dispositionId ?? null,
          resolutionNote: patch.resolutionNote ?? conv[0].resolutionNote ?? null,
        }),
      });
    }

    res.json(updated[0]);
  } catch (err) {
    logger.error({ err }, "Update conversation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

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

      recordMessageUsage(tenantId).catch((usageErr) => {
        logger.warn({ err: usageErr, tenantId }, "Usage tracking failed (non-blocking)");
      });

      res.status(201).json(rows[0]);
    } catch (err) {
      logger.error({ err }, "Send message error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.post("/conversations/:id/claim", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const userId = req.tenantUser!.tenantUserId;
  const id = Number(req.params.id);

  try {
    const rows = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.tenantId, tenantId)))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const conv = rows[0];
    if (conv.assignedUserId !== null) {
      res.status(409).json({ error: "Conversation is already assigned" });
      return;
    }

    const now = new Date();
    await db
      .update(conversationsTable)
      .set({ assignedUserId: userId, assignedAt: now })
      .where(eq(conversationsTable.id, id));

    await db
      .update(tenantUsersTable)
      .set({ lastAssignedAt: now })
      .where(eq(tenantUsersTable.id, userId));

    await db.insert(conversationEventsTable).values({
      conversationId: id,
      eventType: "claimed",
      actorId: userId,
    });

    res.json({ success: true, assignedUserId: userId, assignedAt: now.toISOString() });
  } catch (err) {
    logger.error({ err }, "Claim conversation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/conversations/:id/transfer", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const actorId = req.tenantUser!.tenantUserId;
  const id = Number(req.params.id);
  const { targetUserId, note } = req.body ?? {};

  if (!targetUserId) {
    res.status(400).json({ error: "targetUserId is required" });
    return;
  }

  try {
    const conv = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.tenantId, tenantId)))
      .limit(1);

    if (conv.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const target = await db
      .select({ id: tenantUsersTable.id })
      .from(tenantUsersTable)
      .where(and(eq(tenantUsersTable.id, targetUserId), eq(tenantUsersTable.tenantId, tenantId)))
      .limit(1);

    if (target.length === 0) {
      res.status(404).json({ error: "Target agent not found" });
      return;
    }

    const now = new Date();
    await db
      .update(conversationsTable)
      .set({ assignedUserId: targetUserId, assignedAt: now })
      .where(eq(conversationsTable.id, id));

    await db
      .update(tenantUsersTable)
      .set({ lastAssignedAt: now })
      .where(eq(tenantUsersTable.id, targetUserId));

    await db.insert(conversationEventsTable).values({
      conversationId: id,
      eventType: "transferred",
      actorId,
      targetId: targetUserId,
      note: note || null,
    });

    res.json({ success: true, assignedUserId: targetUserId, assignedAt: now.toISOString() });
  } catch (err) {
    logger.error({ err }, "Transfer conversation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/conversations/:id/unassign", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const actorId = req.tenantUser!.tenantUserId;
  const id = Number(req.params.id);

  try {
    const conv = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.tenantId, tenantId)))
      .limit(1);

    if (conv.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    await db
      .update(conversationsTable)
      .set({ assignedUserId: null, assignedAt: null })
      .where(eq(conversationsTable.id, id));

    await db.insert(conversationEventsTable).values({
      conversationId: id,
      eventType: "unassigned",
      actorId,
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Unassign conversation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/conversations/:id/auto-route", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);

  try {
    const conv = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.tenantId, tenantId)))
      .limit(1);

    if (conv.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    if (!conv[0].departmentId) {
      res.status(400).json({ error: "Conversation has no department — assign a department first" });
      return;
    }

    const dept = await db
      .select({ routingStrategy: departmentsTable.routingStrategy })
      .from(departmentsTable)
      .where(eq(departmentsTable.id, conv[0].departmentId))
      .limit(1);

    const strategy = (dept[0]?.routingStrategy ?? "round_robin") as RoutingStrategy;
    const agentId = await pickAgent(conv[0].departmentId, tenantId, strategy);

    if (!agentId) {
      res.status(422).json({ error: "No online agents available in this department" });
      return;
    }

    const now = new Date();
    await db
      .update(conversationsTable)
      .set({ assignedUserId: agentId, assignedAt: now })
      .where(eq(conversationsTable.id, id));

    await db
      .update(tenantUsersTable)
      .set({ lastAssignedAt: now })
      .where(eq(tenantUsersTable.id, agentId));

    await db.insert(conversationEventsTable).values({
      conversationId: id,
      eventType: "auto_routed",
      targetId: agentId,
      metadata: JSON.stringify({ strategy }),
    });

    res.json({ success: true, assignedUserId: agentId, strategy, assignedAt: now.toISOString() });
  } catch (err) {
    logger.error({ err }, "Auto-route conversation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/conversations/:id/events", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const conversationId = Number(req.params.id);

  try {
    const conv = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.tenantId, tenantId)))
      .limit(1);

    if (conv.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const events = await db
      .select({
        id: conversationEventsTable.id,
        conversationId: conversationEventsTable.conversationId,
        eventType: conversationEventsTable.eventType,
        actorId: conversationEventsTable.actorId,
        targetId: conversationEventsTable.targetId,
        note: conversationEventsTable.note,
        metadata: conversationEventsTable.metadata,
        createdAt: conversationEventsTable.createdAt,
      })
      .from(conversationEventsTable)
      .where(eq(conversationEventsTable.conversationId, conversationId))
      .orderBy(desc(conversationEventsTable.createdAt));

    res.json(events);
  } catch (err) {
    logger.error({ err }, "List conversation events error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
