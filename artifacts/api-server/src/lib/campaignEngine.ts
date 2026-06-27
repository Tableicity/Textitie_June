import { getTenantDb, getTenantPool, campaignsTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSender } from "./senders";
import { extractContactVars, injectVariables, calculateSegments } from "./smsUtils";
import { deductCampaignCredits } from "./creditEngine";
import { simulateDeliveryCallback } from "./deliveryStatus";
import { logger } from "./logger";

const SEND_RATE_PER_SECOND = 10;
const BATCH_INTERVAL_MS = 1000;

interface CampaignContext {
  campaignId: number;
  tenantId: number;
  tenantSlug: string;
  fromNumber: string | null;
  totalToSend: number;
  sentSoFar: number;
  failedSoFar: number;
}

async function sendBatch(ctx: CampaignContext): Promise<boolean> {
  const tpool = getTenantPool(ctx.tenantSlug);
  const claimed = await tpool.query(
    `UPDATE campaign_messages
     SET status = 'sending'
     WHERE id IN (
       SELECT id FROM campaign_messages
       WHERE campaign_id = $1 AND status = 'queued'
       ORDER BY id
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, contact_phone, contact_name, rendered_body`,
    [ctx.campaignId, SEND_RATE_PER_SECOND],
  );

  if (claimed.rows.length === 0) return false;

  const sender = getSender();
  const isStub = sender.name === "stub";

  for (const row of claimed.rows) {
    try {
      const result = await sender.send({
        to: row.contact_phone,
        body: row.rendered_body,
        tenantId: ctx.tenantId,
        conductorAuthorized: false,
        fromOverride: ctx.fromNumber,
      });

      const newStatus = result.status === "failed" ? "failed" : "sent";
      await tpool.query(
        `UPDATE campaign_messages SET status = $1, sent_at = NOW(), external_id = $2, error_message = $3 WHERE id = $4`,
        [
          newStatus,
          result.externalId,
          result.status === "failed" ? result.responseSummary : null,
          row.id,
        ],
      );

      if (newStatus === "sent") {
        ctx.sentSoFar++;
        if (isStub && result.externalId) {
          simulateDeliveryCallback(result.externalId);
        }
      } else {
        ctx.failedSoFar++;
      }
    } catch (err: any) {
      await tpool.query(
        `UPDATE campaign_messages SET status = 'failed', sent_at = NOW(), error_message = $1 WHERE id = $2`,
        [err.message ?? "Unknown error", row.id],
      );
      ctx.failedSoFar++;
    }
  }

  await tpool.query(
    `UPDATE campaigns SET sent_count = $1, failed_count = $2 WHERE id = $3`,
    [ctx.sentSoFar, ctx.failedSoFar, ctx.campaignId],
  );

  return true;
}

export async function executeCampaign(tenantSlug: string, campaignId: number): Promise<void> {
  const tdb = getTenantDb(tenantSlug);
  const tpool = getTenantPool(tenantSlug);

  const campaigns = await tdb
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId))
    .limit(1);

  if (campaigns.length === 0) {
    logger.error({ campaignId, tenantSlug }, "Campaign not found for execution");
    return;
  }

  const campaign = campaigns[0];

  if (campaign.status !== "sending") {
    logger.warn({ campaignId, status: campaign.status }, "Campaign not in sending state");
    return;
  }

  const ctx: CampaignContext = {
    campaignId,
    tenantId: campaign.tenantId,
    tenantSlug,
    fromNumber: null,
    totalToSend: campaign.totalRecipients,
    sentSoFar: campaign.sentCount ?? 0,
    failedSoFar: campaign.failedCount ?? 0,
  };

  // tenants is in public — use the global pool
  const tenantRow = await pool.query(
    `SELECT phone_number FROM tenants WHERE id = $1`,
    [campaign.tenantId],
  );
  ctx.fromNumber = tenantRow.rows[0]?.phone_number ?? null;

  logger.info({ campaignId, tenantSlug, totalRecipients: ctx.totalToSend }, "Campaign execution started");

  const processBatches = async () => {
    let hasMore = true;
    while (hasMore) {
      hasMore = await sendBatch(ctx);
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_INTERVAL_MS));
      }
    }

    if (ctx.sentSoFar > 0) {
      const renderedRows = await tpool.query(
        `SELECT rendered_body FROM campaign_messages WHERE campaign_id = $1 AND status IN ('sent', 'delivered')`,
        [campaignId],
      );
      let totalSegments = 0;
      for (const row of renderedRows.rows) {
        totalSegments += Math.max(1, calculateSegments(row.rendered_body).segmentCount);
      }

      try {
        await deductCampaignCredits(campaign.tenantId, tenantSlug, totalSegments);
      } catch (deductErr) {
        logger.error({ err: deductErr, campaignId, totalSegments }, "Credit deduction failed — campaign marked failed");
        await tpool.query(
          `UPDATE campaigns SET status = 'failed', completed_at = NOW(), sent_count = $1, failed_count = $2 WHERE id = $3`,
          [ctx.sentSoFar, ctx.failedSoFar, campaignId],
        );
        return;
      }
    }

    await tpool.query(
      `UPDATE campaigns SET status = 'completed', completed_at = NOW(), sent_count = $1, failed_count = $2 WHERE id = $3`,
      [ctx.sentSoFar, ctx.failedSoFar, campaignId],
    );

    logger.info(
      { campaignId, tenantSlug, sent: ctx.sentSoFar, failed: ctx.failedSoFar },
      "Campaign execution completed",
    );
  };

  processBatches().catch((err) => {
    logger.error({ err, campaignId }, "Campaign execution crashed");
    tpool.query(
      `UPDATE campaigns SET status = 'failed', completed_at = NOW() WHERE id = $1`,
      [campaignId],
    ).catch(() => {});
  });
}

export async function buildAudience(
  tenantId: number,
  tenantSlug: string,
  filter: { tags?: string[]; status?: string; lastInteractionBefore?: string; lastInteractionAfter?: string } | null,
): Promise<Array<{ id: number; contactPhone: string; contactName: string | null }>> {
  const tpool = getTenantPool(tenantSlug);
  let query = `
    SELECT c.id, c.contact_phone, c.contact_name
    FROM conversations c
    WHERE c.tenant_id = $1
      AND c.is_quarantined = false
      AND NOT EXISTS (
        SELECT 1 FROM opt_outs o
        WHERE o.tenant_id = c.tenant_id AND o.phone_number = c.contact_phone
      )
      AND NOT EXISTS (
        SELECT 1 FROM contacts ct
        WHERE ct.tenant_id = c.tenant_id AND ct.phone = c.contact_phone AND ct.blocked = true
          AND ct.is_quarantined = false
      )
  `;
  const params: any[] = [tenantId];
  let paramIdx = 2;

  if (filter?.tags && filter.tags.length > 0) {
    query += ` AND c.tags && $${paramIdx}::text[]`;
    params.push(filter.tags);
    paramIdx++;
  }

  if (filter?.status) {
    query += ` AND c.status = $${paramIdx}`;
    params.push(filter.status);
    paramIdx++;
  }

  if (filter?.lastInteractionAfter) {
    query += ` AND c.last_message_at >= $${paramIdx}::timestamptz`;
    params.push(filter.lastInteractionAfter);
    paramIdx++;
  }

  if (filter?.lastInteractionBefore) {
    query += ` AND c.last_message_at <= $${paramIdx}::timestamptz`;
    params.push(filter.lastInteractionBefore);
    paramIdx++;
  }

  query += ` ORDER BY c.contact_name ASC`;

  const result = await tpool.query(query, params);
  return result.rows.map((r: any) => ({
    id: r.id,
    contactPhone: r.contact_phone,
    contactName: r.contact_name,
  }));
}

export async function createCampaignMessages(
  tenantSlug: string,
  campaignId: number,
  audience: Array<{ id: number; contactPhone: string; contactName: string | null }>,
  templateBody: string,
): Promise<number> {
  if (audience.length === 0) return 0;
  const tpool = getTenantPool(tenantSlug);

  const values: string[] = [];
  const params: any[] = [];
  let idx = 1;

  for (const contact of audience) {
    const vars = extractContactVars(contact.contactName, contact.contactPhone);
    const rendered = injectVariables(templateBody, vars);
    values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, 'queued')`);
    params.push(campaignId, contact.id, contact.contactPhone, contact.contactName, rendered);
    idx += 5;
  }

  await tpool.query(
    `INSERT INTO campaign_messages (campaign_id, conversation_id, contact_phone, contact_name, rendered_body, status)
     VALUES ${values.join(", ")}`,
    params,
  );

  return audience.length;
}

export async function activateScheduledCampaign(
  tenantSlug: string,
  campaignId: number,
): Promise<{ ok: boolean; reason?: string }> {
  const { preFlightCheck } = await import("./creditEngine");
  const tdb = getTenantDb(tenantSlug);
  const tpool = getTenantPool(tenantSlug);

  const rows = await tdb
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId))
    .limit(1);
  if (rows.length === 0) return { ok: false, reason: "not found" };
  const campaign = rows[0];
  if (campaign.status !== "draft") return { ok: false, reason: `status=${campaign.status}` };

  const audience = await buildAudience(campaign.tenantId, tenantSlug, campaign.segmentFilter as any);
  if (audience.length === 0) {
    await tpool.query(
      `UPDATE campaigns SET status = 'failed', completed_at = NOW() WHERE id = $1 AND status = 'draft'`,
      [campaignId],
    );
    return { ok: false, reason: "no eligible recipients" };
  }

  const segInfo = calculateSegments(campaign.body);
  const segCount = Math.max(1, segInfo.segmentCount);
  const preflight = await preFlightCheck(campaign.tenantId, tenantSlug, audience.length, segCount);
  if (!preflight.allowed) {
    await tpool.query(
      `UPDATE campaigns SET status = 'failed', completed_at = NOW() WHERE id = $1 AND status = 'draft'`,
      [campaignId],
    );
    return { ok: false, reason: `insufficient credits (need ${preflight.requiredCredits}, have ${preflight.availableCredits})` };
  }

  const claimed = await tpool.query(
    `UPDATE campaigns SET status = 'sending', started_at = NOW()
     WHERE id = $1 AND status = 'draft'
     RETURNING id`,
    [campaignId],
  );
  if (claimed.rows.length === 0) return { ok: false, reason: "race lost" };

  const queued = await createCampaignMessages(tenantSlug, campaignId, audience, campaign.body);
  await tpool.query(
    `UPDATE campaigns SET total_recipients = $1, queued_count = $2, credits_required = $3 WHERE id = $4`,
    [audience.length, queued, audience.length * segCount, campaignId],
  );

  executeCampaign(tenantSlug, campaignId).catch((err) => {
    logger.error({ err, campaignId }, "Scheduled campaign execution error (fire-and-forget)");
  });

  return { ok: true };
}
