import { Router } from "express";
import { db, integrationsTable, crmSyncQueueTable, contactsTable, conversationsTable, dispositionsTable } from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";
import { recordAudit } from "../lib/audit";
import { getSimLog } from "../lib/integrations/hubspotStub";
import { enqueueSync } from "../lib/integrations/syncWorker";
import type { Request, Response, NextFunction } from "express";

const router = Router();

const SUPPORTED_PROVIDERS = new Set(["hubspot"]);

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.tenantUser?.role;
  if (role !== "admin" && role !== "owner") {
    res.status(403).json({ error: "Admin or owner role required" });
    return;
  }
  next();
}

router.get("/integrations", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    const rows = await db
      .select()
      .from(integrationsTable)
      .where(eq(integrationsTable.tenantId, tenantId))
      .orderBy(integrationsTable.provider);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List integrations error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/integrations/:provider/connect", requireTenantAuth, requireAdmin, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const provider = String(req.params.provider);
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    res.status(400).json({ error: `Unsupported provider: ${provider}` });
    return;
  }
  const { displayName, settings } = req.body ?? {};
  try {
    const now = new Date();
    const inserted = await db
      .insert(integrationsTable)
      .values({
        tenantId,
        provider,
        status: "connected",
        displayName: typeof displayName === "string" ? displayName : `${provider} (Stub)`,
        configJson: { mode: "stub" },
        settingsJson: typeof settings === "object" && settings !== null ? settings : {},
        connectedAt: now,
        lastError: null,
      })
      .onConflictDoUpdate({
        target: [integrationsTable.tenantId, integrationsTable.provider],
        set: {
          status: "connected",
          displayName: typeof displayName === "string" ? displayName : sql`${integrationsTable.displayName}`,
          connectedAt: now,
          lastError: null,
          updatedAt: now,
        },
      })
      .returning();
    await recordAudit(req, {
      action: "integration.connected",
      entityType: "integration",
      entityId: inserted[0].id,
      after: { provider, displayName: inserted[0].displayName },
    });
    res.status(201).json(inserted[0]);
  } catch (err) {
    logger.error({ err }, "Connect integration error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/integrations/:provider/disconnect", requireTenantAuth, requireAdmin, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const provider = String(req.params.provider);
  try {
    const rows = await db
      .update(integrationsTable)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(and(eq(integrationsTable.tenantId, tenantId), eq(integrationsTable.provider, provider)))
      .returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    await recordAudit(req, {
      action: "integration.disconnected",
      entityType: "integration",
      entityId: rows[0].id,
      after: { provider },
    });
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Disconnect integration error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/integrations/:provider/sync-queue", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const provider = String(req.params.provider);
  try {
    const rows = await db
      .select()
      .from(crmSyncQueueTable)
      .where(
        and(
          eq(crmSyncQueueTable.tenantId, tenantId),
          eq(crmSyncQueueTable.provider, provider),
        ),
      )
      .orderBy(desc(crmSyncQueueTable.createdAt))
      .limit(50);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List sync queue error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/integrations/hubspot/sim-log", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  res.json(getSimLog(tenantId));
});

router.post("/integrations/:provider/resync", requireTenantAuth, requireAdmin, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const provider = String(req.params.provider);
  if (provider !== "hubspot") {
    res.status(400).json({ error: `Unsupported provider: ${provider}` });
    return;
  }
  try {
    const integ = await db
      .select({ status: integrationsTable.status })
      .from(integrationsTable)
      .where(and(eq(integrationsTable.tenantId, tenantId), eq(integrationsTable.provider, provider)))
      .limit(1);
    if (integ.length === 0 || integ[0].status !== "connected") {
      res.status(400).json({ error: "Integration not connected" });
      return;
    }

    const allContacts = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.tenantId, tenantId), eq(contactsTable.isQuarantined, false)));
    let enqueued = 0;
    for (const c of allContacts) {
      const [first, ...rest] = (c.name ?? "").split(/\s+/).filter(Boolean);
      await enqueueSync({
        tenantId,
        tenantSlug: req.tenantUser!.tenantSlug,
        provider: "hubspot",
        entityType: "contact",
        entityId: c.id,
        op: "upsert",
        payload: {
          phone: c.phone,
          email: c.email,
          firstName: first ?? null,
          lastName: rest.length > 0 ? rest.join(" ") : null,
          tags: c.tags ?? [],
        },
      });
      enqueued += 1;
    }

    const closed = await db
      .select({
        id: conversationsTable.id,
        contactPhone: conversationsTable.contactPhone,
        contactName: conversationsTable.contactName,
        resolutionNote: conversationsTable.resolutionNote,
        dispositionLabel: dispositionsTable.label,
      })
      .from(conversationsTable)
      .leftJoin(dispositionsTable, eq(dispositionsTable.id, conversationsTable.dispositionId))
      .where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.status, "closed")));

    for (const c of closed) {
      await enqueueSync({
        tenantId,
        tenantSlug: req.tenantUser!.tenantSlug,
        provider: "hubspot",
        entityType: "conversation",
        entityId: c.id,
        op: "log_activity",
        payload: {
          externalContactId: `phone:${c.contactPhone}`,
          body: `Conversation #${c.id} resolved. Disposition: ${c.dispositionLabel ?? "n/a"}. Note: ${c.resolutionNote ?? ""}`,
          metadata: { conversationId: c.id, disposition: c.dispositionLabel },
        },
      });
      enqueued += 1;
    }

    await recordAudit(req, {
      action: "integration.resync_triggered",
      entityType: "integration",
      entityId: provider,
      after: { enqueued },
    });
    res.json({ enqueued });
  } catch (err) {
    logger.error({ err }, "Resync error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
