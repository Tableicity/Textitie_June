import { Router } from "express";
import { db, campaignsTable, campaignMessagesTable, conversationsTable, tenantsTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";
import { calculateSegments } from "../lib/smsUtils";
import { preFlightCheck, getCreditBalance } from "../lib/creditEngine";
import { executeCampaign, buildAudience, createCampaignMessages } from "../lib/campaignEngine";

const router = Router();

router.get("/campaigns", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;

  try {
    const rows = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.tenantId, tenantId))
      .orderBy(desc(campaignsTable.createdAt));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List campaigns error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/campaigns", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { name, body, segmentFilter, scheduledAt } = req.body ?? {};

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Campaign name is required" });
    return;
  }
  if (!body || typeof body !== "string" || body.trim().length === 0) {
    res.status(400).json({ error: "Campaign body is required" });
    return;
  }

  let scheduledAtDate: Date | null = null;
  if (scheduledAt) {
    const parsed = new Date(scheduledAt);
    if (Number.isNaN(parsed.getTime())) {
      res.status(400).json({ error: "scheduledAt must be a valid ISO date-time" });
      return;
    }
    scheduledAtDate = parsed;
  }

  try {
    const audience = await buildAudience(tenantId, req.tenantUser!.tenantSlug, segmentFilter ?? null);
    const segInfo = calculateSegments(body);
    const creditsRequired = audience.length * Math.max(1, segInfo.segmentCount);

    const rows = await db
      .insert(campaignsTable)
      .values({
        tenantId,
        name: name.trim(),
        body: body.trim(),
        status: "draft",
        segmentFilter: segmentFilter ?? null,
        totalRecipients: audience.length,
        creditsRequired,
        scheduledAt: scheduledAtDate,
        createdBy: req.tenantUser!.tenantUserId,
      })
      .returning();

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Create campaign error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/campaigns/:id/schedule", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  const { scheduledAt } = req.body ?? {};

  if (!scheduledAt) {
    res.status(400).json({ error: "scheduledAt is required" });
    return;
  }
  const parsed = new Date(scheduledAt);
  if (Number.isNaN(parsed.getTime())) {
    res.status(400).json({ error: "scheduledAt must be a valid ISO date-time" });
    return;
  }
  if (parsed.getTime() <= Date.now()) {
    res.status(400).json({ error: "scheduledAt must be in the future" });
    return;
  }

  try {
    const updated = await db
      .update(campaignsTable)
      .set({ scheduledAt: parsed })
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.tenantId, tenantId), eq(campaignsTable.status, "draft")))
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "Draft campaign not found" });
      return;
    }
    res.json(updated[0]);
  } catch (err) {
    logger.error({ err }, "Schedule campaign error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/campaigns/:id/unschedule", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  try {
    const updated = await db
      .update(campaignsTable)
      .set({ scheduledAt: null })
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.tenantId, tenantId), eq(campaignsTable.status, "draft")))
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "Draft campaign not found" });
      return;
    }
    res.json(updated[0]);
  } catch (err) {
    logger.error({ err }, "Unschedule campaign error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/campaigns/credits", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;

  try {
    const balance = await getCreditBalance(tenantId, req.tenantUser!.tenantSlug);
    res.json(balance);
  } catch (err) {
    logger.error({ err }, "Get credit balance error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// NOTE: the old `POST /campaigns/top-up` route was REMOVED — it granted add-on
// credits for FREE (no charge, non-idempotent). Buying credits is now a real
// Stripe purchase via `POST /billing/credits-checkout` (webhook-fulfilled).

router.post("/campaigns/audience-preview", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { segmentFilter } = req.body ?? {};

  try {
    const audience = await buildAudience(tenantId, req.tenantUser!.tenantSlug, segmentFilter ?? null);
    res.json({
      count: audience.length,
      contacts: audience.slice(0, 20),
    });
  } catch (err) {
    logger.error({ err }, "Audience preview error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/campaigns/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);

  try {
    const rows = await db
      .select()
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.tenantId, tenantId)))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Get campaign error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/campaigns/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);

  try {
    const rows = await db
      .select()
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.tenantId, tenantId)))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    if (rows[0].status === "sending") {
      res.status(409).json({ error: "Cannot delete a campaign that is currently sending" });
      return;
    }

    await db.delete(campaignMessagesTable).where(eq(campaignMessagesTable.campaignId, id));
    await db.delete(campaignsTable).where(eq(campaignsTable.id, id));

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Delete campaign error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/campaigns/:id/send", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);

  try {
    const rows = await db
      .select()
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.tenantId, tenantId)))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const campaign = rows[0];
    if (campaign.status !== "draft") {
      res.status(409).json({ error: `Campaign is already ${campaign.status}` });
      return;
    }

    const audience = await buildAudience(tenantId, req.tenantUser!.tenantSlug, campaign.segmentFilter as any);
    if (audience.length === 0) {
      res.status(422).json({ error: "No eligible recipients found" });
      return;
    }

    const segInfo = calculateSegments(campaign.body);
    const segCount = Math.max(1, segInfo.segmentCount);

    const preflight = await preFlightCheck(tenantId, req.tenantUser!.tenantSlug, audience.length, segCount);
    if (!preflight.allowed) {
      res.status(402).json({
        error: "Insufficient credits",
        required: preflight.requiredCredits,
        available: preflight.availableCredits,
        shortfall: preflight.shortfall,
        overageEnabled: preflight.overageEnabled,
      });
      return;
    }

    const claimed = await pool.query(
      `UPDATE campaigns SET status = 'sending', started_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = 'draft'
       RETURNING id`,
      [id, tenantId],
    );
    if (claimed.rows.length === 0) {
      res.status(409).json({ error: "Campaign already picked up by another request" });
      return;
    }

    const queued = await createCampaignMessages(req.tenantUser!.tenantSlug, id, audience, campaign.body);

    await pool.query(
      `UPDATE campaigns SET total_recipients = $1, queued_count = $2, credits_required = $3 WHERE id = $4`,
      [audience.length, queued, audience.length * segCount, id],
    );

    executeCampaign(req.tenantUser!.tenantSlug, id).catch((err) => {
      logger.error({ err, campaignId: id }, "Campaign execution error (fire-and-forget)");
    });

    res.json({
      success: true,
      campaignId: id,
      recipientCount: audience.length,
      creditsRequired: audience.length * segCount,
      preFlightCheck: preflight,
    });
  } catch (err) {
    logger.error({ err }, "Send campaign error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/campaigns/:id/messages", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);

  try {
    const campaign = await db
      .select()
      .from(campaignsTable)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.tenantId, tenantId)))
      .limit(1);

    if (campaign.length === 0) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const messages = await db
      .select()
      .from(campaignMessagesTable)
      .where(eq(campaignMessagesTable.campaignId, id))
      .orderBy(campaignMessagesTable.id);

    res.json(messages);
  } catch (err) {
    logger.error({ err }, "List campaign messages error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/conversations/:id/tags", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  const { tags } = req.body ?? {};

  if (!Array.isArray(tags)) {
    res.status(400).json({ error: "tags must be an array of strings" });
    return;
  }

  try {
    const conv = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.isQuarantined, false)))
      .limit(1);

    if (conv.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const cleanTags = tags.filter((t: any) => typeof t === "string" && t.trim().length > 0).map((t: string) => t.trim().toLowerCase());

    await db
      .update(conversationsTable)
      .set({ tags: cleanTags })
      .where(eq(conversationsTable.id, id));

    res.json({ success: true, tags: cleanTags });
  } catch (err) {
    logger.error({ err }, "Update conversation tags error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
