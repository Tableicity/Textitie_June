import { Router } from "express";
import { db, conversationsTable, messagesTable, departmentsTable, conversationEventsTable, tenantUsersTable, dispositionsTable, contactsTable, tenantsTable, type ConversationAiStateRow } from "@workspace/db";
import { sendConversationReply } from "../lib/outboundReply";
import { eventBus } from "../lib/eventBus";
import { eq, and, desc, isNull, ilike, or, gte, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";
import { pickAgent } from "../lib/routing";
import type { RoutingStrategy } from "../lib/routing";
import { recordAudit } from "../lib/audit";
import { enqueueSync } from "../lib/integrations/syncWorker";
import { maybeEnqueueSurveyForClose } from "../lib/surveyDispatcher";
import {
  ENGAGEMENT_MODES,
  normalizeEngagementMode,
  resolveEffectiveEngagementMode,
  type EngagementMode,
} from "../lib/engagementPolicy";
import {
  getConversationAiState,
  getConversationAiStates,
  markConversationAiStateHumanHandled,
} from "../lib/aiStateStore";

const router = Router();

/**
 * Shape a stored AI-state row into the API `aiState` object (or null). Drives
 * the inbox send-button color and the Co-Pilot draft. Dates serialize to ISO so
 * the generated client type (string, date-time) matches the wire format.
 */
function toApiAiState(row: ConversationAiStateRow | null) {
  if (!row) return null;
  return {
    status: row.status,
    draftBody: row.draftBody,
    draftSource: row.draftSource,
    confidence: row.confidence,
    queryCategory: row.queryCategory,
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    latestInboundMessageId: row.latestInboundMessageId,
    outboundMessageId: row.outboundMessageId,
    autoSentAt: row.autoSentAt ? row.autoSentAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Load + normalize the tenant's default engagement mode (one lookup). */
async function getTenantEngagementMode(
  tenantId: number,
): Promise<EngagementMode> {
  const rows = await db
    .select({ engagementMode: tenantsTable.engagementMode })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  return normalizeEngagementMode(rows[0]?.engagementMode);
}

router.get("/conversations", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const assignedUserId = req.query.assignedUserId ? Number(req.query.assignedUserId) : undefined;
  const fromStr = typeof req.query.from === "string" ? req.query.from : "";
  const toStr = typeof req.query.to === "string" ? req.query.to : "";

  try {
    const conditions = [
      eq(conversationsTable.tenantId, tenantId),
      // Quarantined imports never appear in the live inbox until flipped live.
      eq(conversationsTable.isQuarantined, false),
    ];
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
        sql`EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = ${conversationsTable.id} AND m.is_quarantined = false AND m.body ILIKE ${pat})`,
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
        contactName: sql<string | null>`coalesce(${contactsTable.name}, ${conversationsTable.contactName})`,
        status: conversationsTable.status,
        dispositionId: conversationsTable.dispositionId,
        resolutionNote: conversationsTable.resolutionNote,
        tags: conversationsTable.tags,
        assignedUserId: conversationsTable.assignedUserId,
        assignedAt: conversationsTable.assignedAt,
        lastMessageAt: conversationsTable.lastMessageAt,
        createdAt: conversationsTable.createdAt,
        contactLocation: contactsTable.location,
        engagementModeOverride: conversationsTable.engagementModeOverride,
      })
      .from(conversationsTable)
      .leftJoin(
        contactsTable,
        and(
          eq(contactsTable.tenantId, conversationsTable.tenantId),
          eq(contactsTable.phone, conversationsTable.contactPhone),
          // Quarantined imported contacts never join into a live conversation read
          // (with the partial-live unique index, a phone may have both a live and a
          // quarantined contact — without this filter the join would double rows).
          eq(contactsTable.isQuarantined, false),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(conversationsTable.lastMessageAt))
      .limit(500);

    const tenantMode = await getTenantEngagementMode(tenantId);
    const aiStates = await getConversationAiStates(
      tenantId,
      rows.map((r) => r.id),
    );
    const enriched = rows.map((r) => ({
      ...r,
      effectiveEngagementMode: resolveEffectiveEngagementMode(
        r.engagementModeOverride,
        tenantMode,
      ),
      aiState: toApiAiState(aiStates.get(r.id) ?? null),
    }));

    res.json(enriched);
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
      .select({
        id: conversationsTable.id,
        tenantId: conversationsTable.tenantId,
        departmentId: conversationsTable.departmentId,
        contactId: conversationsTable.contactId,
        contactPhone: conversationsTable.contactPhone,
        contactName: sql<string | null>`coalesce(${contactsTable.name}, ${conversationsTable.contactName})`,
        status: conversationsTable.status,
        dispositionId: conversationsTable.dispositionId,
        resolutionNote: conversationsTable.resolutionNote,
        tags: conversationsTable.tags,
        assignedUserId: conversationsTable.assignedUserId,
        assignedAt: conversationsTable.assignedAt,
        lastMessageAt: conversationsTable.lastMessageAt,
        createdAt: conversationsTable.createdAt,
        contactLocation: contactsTable.location,
        engagementModeOverride: conversationsTable.engagementModeOverride,
      })
      .from(conversationsTable)
      .leftJoin(
        contactsTable,
        and(
          eq(contactsTable.tenantId, conversationsTable.tenantId),
          eq(contactsTable.phone, conversationsTable.contactPhone),
          // Quarantined imported contacts never join into a live conversation read
          // (with the partial-live unique index, a phone may have both a live and a
          // quarantined contact — without this filter the join would double rows).
          eq(contactsTable.isQuarantined, false),
        ),
      )
      .where(
        and(
          eq(conversationsTable.id, id),
          eq(conversationsTable.tenantId, tenantId),
          eq(conversationsTable.isQuarantined, false),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const tenantMode = await getTenantEngagementMode(tenantId);
    const aiState = await getConversationAiState(tenantId, id);
    res.json({
      ...rows[0],
      effectiveEngagementMode: resolveEffectiveEngagementMode(
        rows[0].engagementModeOverride,
        tenantMode,
      ),
      aiState: toApiAiState(aiState),
    });
  } catch (err) {
    logger.error({ err }, "Get conversation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/conversations", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { contactPhone, contactName, departmentId } = req.body ?? {};
  const phone = typeof contactPhone === "string" ? contactPhone.trim() : "";
  if (!phone) {
    res.status(400).json({ error: "contactPhone is required" });
    return;
  }
  const name =
    typeof contactName === "string" && contactName.trim().length > 0
      ? contactName.trim()
      : null;
  const deptId =
    typeof departmentId === "number" && Number.isFinite(departmentId)
      ? departmentId
      : null;

  try {
    // Tenant-scope check: if a department was specified, it must belong to this tenant.
    if (deptId !== null) {
      const dept = await db
        .select({ id: departmentsTable.id })
        .from(departmentsTable)
        .where(
          and(eq(departmentsTable.id, deptId), eq(departmentsTable.tenantId, tenantId)),
        )
        .limit(1);
      if (dept.length === 0) {
        res.status(400).json({ error: "departmentId not found for this tenant" });
        return;
      }
    }

    // Always upsert the contact first so name enrichment happens whether we reuse or create.
    const contactRows = await db
      .insert(contactsTable)
      .values({ tenantId, phone, name })
      .onConflictDoUpdate({
        target: [contactsTable.tenantId, contactsTable.phone],
        // Match the partial-live unique index; never touch a quarantined import.
        targetWhere: eq(contactsTable.isQuarantined, false),
        set: name ? { name, updatedAt: new Date() } : { updatedAt: new Date() },
      })
      .returning({ id: contactsTable.id, location: contactsTable.location });
    const contact = contactRows[0];

    // Reuse an existing OPEN conversation for this phone if one exists.
    const existing = await db
      .select({
        id: conversationsTable.id,
        tenantId: conversationsTable.tenantId,
        departmentId: conversationsTable.departmentId,
        contactId: conversationsTable.contactId,
        contactPhone: conversationsTable.contactPhone,
        contactName: sql<string | null>`coalesce(${contactsTable.name}, ${conversationsTable.contactName})`,
        status: conversationsTable.status,
        dispositionId: conversationsTable.dispositionId,
        resolutionNote: conversationsTable.resolutionNote,
        tags: conversationsTable.tags,
        assignedUserId: conversationsTable.assignedUserId,
        assignedAt: conversationsTable.assignedAt,
        lastMessageAt: conversationsTable.lastMessageAt,
        createdAt: conversationsTable.createdAt,
        contactLocation: contactsTable.location,
        engagementModeOverride: conversationsTable.engagementModeOverride,
      })
      .from(conversationsTable)
      .leftJoin(
        contactsTable,
        and(
          eq(contactsTable.tenantId, conversationsTable.tenantId),
          eq(contactsTable.phone, conversationsTable.contactPhone),
          // Quarantined imported contacts never join into a live conversation read
          // (with the partial-live unique index, a phone may have both a live and a
          // quarantined contact — without this filter the join would double rows).
          eq(contactsTable.isQuarantined, false),
        ),
      )
      .where(
        and(
          eq(conversationsTable.tenantId, tenantId),
          eq(conversationsTable.contactPhone, phone),
          eq(conversationsTable.status, "open"),
          // Never reuse a quarantined import for a live conversation.
          eq(conversationsTable.isQuarantined, false),
        ),
      )
      .orderBy(desc(conversationsTable.lastMessageAt))
      .limit(1);

    const tenantMode = await getTenantEngagementMode(tenantId);

    if (existing.length > 0) {
      const aiState = await getConversationAiState(tenantId, existing[0].id);
      res.status(200).json({
        ...existing[0],
        effectiveEngagementMode: resolveEffectiveEngagementMode(
          existing[0].engagementModeOverride,
          tenantMode,
        ),
        aiState: toApiAiState(aiState),
      });
      return;
    }

    const created = await db
      .insert(conversationsTable)
      .values({
        tenantId,
        contactPhone: phone,
        contactName: name,
        contactId: contact?.id ?? null,
        departmentId: deptId,
        status: "open",
      })
      .returning();

    await recordAudit(req, {
      action: "conversation.created",
      entityType: "conversation",
      entityId: created[0].id,
      after: { contactPhone: phone, contactName: name, departmentId: deptId },
    });

    res.status(201).json({
      ...created[0],
      contactLocation: contact?.location ?? null,
      effectiveEngagementMode: resolveEffectiveEngagementMode(
        created[0].engagementModeOverride,
        tenantMode,
      ),
      aiState: null,
    });
  } catch (err) {
    logger.error({ err }, "Create conversation error");
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
            eq(conversationsTable.isQuarantined, false),
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
        .where(
          and(
            eq(messagesTable.conversationId, conversationId),
            eq(messagesTable.isQuarantined, false),
          ),
        )
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
        .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.isQuarantined, false)))
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
  const { status, dispositionId, resolutionNote, engagementModeOverride } =
    req.body ?? {};

  if (status !== undefined && status !== "open" && status !== "closed") {
    res.status(400).json({ error: "status must be 'open' or 'closed'" });
    return;
  }

  // null clears the override (inherit tenant). Legacy aliases (assisted→copilot,
  // gated_auto→autopilot) are folded to canonical so all engagement-mode writes
  // behave consistently; we always persist a canonical value.
  let normalizedOverride: string | null | undefined = engagementModeOverride;
  if (engagementModeOverride !== undefined && engagementModeOverride !== null) {
    const canonical =
      engagementModeOverride === "assisted"
        ? "copilot"
        : engagementModeOverride === "gated_auto"
          ? "autopilot"
          : engagementModeOverride;
    if (!(ENGAGEMENT_MODES as readonly string[]).includes(canonical)) {
      res.status(400).json({
        error:
          "engagementModeOverride must be one of manual, copilot, autopilot, or null",
      });
      return;
    }
    normalizedOverride = canonical;
  }

  try {
    const conv = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.isQuarantined, false)))
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
    if (engagementModeOverride !== undefined) {
      // null = clear the override (inherit the tenant default). Aliases folded above.
      patch.engagementModeOverride = normalizedOverride as
        | (typeof ENGAGEMENT_MODES)[number]
        | null;
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

      let dispLabel: string | null = null;
      const dispId = patch.dispositionId ?? conv[0].dispositionId ?? null;
      if (dispId) {
        const d = await db
          .select({ label: dispositionsTable.label })
          .from(dispositionsTable)
          .where(eq(dispositionsTable.id, dispId as number))
          .limit(1);
        dispLabel = d[0]?.label ?? null;
      }
      await enqueueSync({
        tenantId,
        tenantSlug: req.tenantUser!.tenantSlug,
        provider: "hubspot",
        entityType: "conversation",
        entityId: id,
        op: "log_activity",
        payload: {
          externalContactId: `phone:${conv[0].contactPhone}`,
          body: `Conversation #${id} resolved. Disposition: ${dispLabel ?? "n/a"}. Note: ${patch.resolutionNote ?? conv[0].resolutionNote ?? ""}`,
          metadata: { conversationId: id, disposition: dispLabel },
        },
      });

      await maybeEnqueueSurveyForClose({
        tenantId,
        tenantSlug: req.tenantUser!.tenantSlug,
        conversationId: id,
        contactPhone: conv[0].contactPhone,
      });
    }

    await recordAudit(req, {
      action: status === "closed" ? "conversation.resolved" : "conversation.updated",
      entityType: "conversation",
      entityId: id,
      before: { status: conv[0].status, dispositionId: conv[0].dispositionId, resolutionNote: conv[0].resolutionNote },
      after: { status: updated[0].status, dispositionId: updated[0].dispositionId, resolutionNote: updated[0].resolutionNote },
    });

    const tenantMode = await getTenantEngagementMode(tenantId);
    const aiState = await getConversationAiState(tenantId, id);
    res.json({
      ...updated[0],
      effectiveEngagementMode: resolveEffectiveEngagementMode(
        updated[0].engagementModeOverride,
        tenantMode,
      ),
      aiState: toApiAiState(aiState),
    });
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
        .select({
          id: conversationsTable.id,
          contactPhone: conversationsTable.contactPhone,
          departmentId: conversationsTable.departmentId,
        })
        .from(conversationsTable)
        .where(
          and(
            eq(conversationsTable.id, conversationId),
            eq(conversationsTable.tenantId, tenantId),
            // A quarantined import must never send a real outbound SMS.
            eq(conversationsTable.isQuarantined, false),
          ),
        )
        .limit(1);

      if (convRows.length === 0) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      const conv = convRows[0];

      // Compliance, From-resolution, persist-first, send, and status update all
      // live in the shared helper so the agent reply path and the B4 auto-send
      // path can never drift. HTTP status mapping stays here.
      const result = await sendConversationReply({
        tenantId,
        tenantSlug: req.tenantUser!.tenantSlug,
        conversationId,
        contactPhone: conv.contactPhone,
        departmentId: conv.departmentId,
        body: body.trim(),
        senderName: req.tenantUser!.email,
        conductorAuthorized: true,
      });

      if (!result.ok) {
        if (result.reason === "compliance") {
          res.status(422).json({ error: result.errorMessage, reason: result.complianceReason });
          return;
        }
        if (result.reason === "paywall_new_contact") {
          // Demo paywall: unpaid tenant tried to text a non-signup contact.
          res.status(402).json({ error: result.errorMessage, reason: result.reason });
          return;
        }
        if (result.reason === "daily_trial_limit") {
          // Trial daily outbound-segment budget exhausted (rolling 24h).
          res.status(402).json({ error: result.errorMessage, reason: result.reason });
          return;
        }
        if (result.reason === "trial_expired") {
          // Free trial fully expired — full takeover, no sends until upgrade.
          res.status(402).json({ error: result.errorMessage, reason: result.reason });
          return;
        }
        if (result.reason === "credit_frozen") {
          // Out of messaging credits (no coverage across all buckets).
          res.status(402).json({ error: result.errorMessage, reason: result.reason });
          return;
        }
        // no_sending_number | number_not_owned
        res.status(422).json({ error: result.errorMessage, reason: result.reason });
        return;
      }

      if (result.status !== "sent") {
        logger.warn(
          {
            conversationId,
            tenantId,
            messageId: result.messageRow.id,
            summary: result.sendSummary,
          },
          "Outbound send failed; message persisted with status=failed",
        );
        res.status(502).json({
          error: "Carrier rejected the message",
          detail: result.sendSummary,
          message: result.messageRow,
        });
        return;
      }

      await db
        .update(conversationsTable)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversationsTable.id, conversationId));

      // A human took the wheel for this reply: flip any pending AI state
      // (drafted / refused / failed) to human_handled. This both leaves the
      // Co-Pilot / Blue-handback UI state AND encodes the learning guarantee —
      // a human touch means we never learn from this exchange (learning only
      // fires on an autonomous, unedited auto-send). Non-blocking: the message
      // already went out, so a bookkeeping failure must not 500 the send.
      const aiHandled = await markConversationAiStateHumanHandled({
        tenantId,
        conversationId,
        humanHandledBy: req.tenantUser!.tenantUserId,
      }).catch((stateErr) => {
        logger.warn(
          { err: stateErr, conversationId },
          "Failed to mark AI state human_handled (non-blocking)",
        );
        return false;
      });

      // Credit deduction now happens inside sendConversationReply (charged only
      // on a confirmed send, idempotent, segment/MMS-accurate) — no flat
      // per-message usage bump here.

      eventBus.publish(tenantId, {
        type: "message:new",
        conversationId,
        direction: "outbound",
      });

      // Broadcast the takeover so every open inbox converges to human_handled —
      // the send path is the ONLY place that flips a pending AI state when a
      // human replies, and the async Co-Pilot pipeline can re-stage a draft for
      // this turn a beat later. Without this event the inbox detail query would
      // stay on the stale draft until the next manual refetch. Publishing the
      // bare ai:state signal lets the client refetch the authoritative state.
      if (aiHandled) {
        eventBus.publish(tenantId, { type: "ai:state", conversationId });
      }

      res.status(201).json(result.messageRow);
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
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.isQuarantined, false)))
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
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.isQuarantined, false)))
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
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.isQuarantined, false)))
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
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.isQuarantined, false)))
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
    const agentId = await pickAgent(conv[0].departmentId, tenantId, req.tenantUser!.tenantSlug, strategy);

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
      .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.isQuarantined, false)))
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
