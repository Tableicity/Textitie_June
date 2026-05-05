import { getTenantPool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Last-Touch Attribution within a 72-hour window.
 *
 * When a contact replies to or opts out of a campaign, attribute the action
 * to the MOST RECENT campaign message that was sent to that contact within
 * the last 72 hours. This prevents:
 *  - Random "thank you" replies weeks later from skewing campaign ROI
 *  - Multi-campaign double-counting (Monday's "Discount" vs Tuesday's "Greeting")
 *
 * All campaign tables are per-tenant (in tenant_<slug> schemas), so callers
 * MUST pass the tenantSlug in addition to tenantId.
 */

const ATTRIBUTION_WINDOW_HOURS = 72;

interface AttributedCampaign {
  campaignMessageId: number;
  campaignId: number;
}

async function findLastTouchCampaign(
  tenantId: number,
  tenantSlug: string,
  contactPhone: string,
): Promise<AttributedCampaign | null> {
  const tpool = getTenantPool(tenantSlug);
  const result = await tpool.query(
    `SELECT cm.id AS campaign_message_id, cm.campaign_id
     FROM campaign_messages cm
     JOIN campaigns c ON c.id = cm.campaign_id
     WHERE c.tenant_id = $1
       AND cm.contact_phone = $2
       AND cm.sent_at IS NOT NULL
       AND cm.sent_at >= NOW() - INTERVAL '${ATTRIBUTION_WINDOW_HOURS} hours'
       AND cm.status IN ('sent', 'delivered')
     ORDER BY cm.sent_at DESC
     LIMIT 1`,
    [tenantId, contactPhone],
  );

  if (result.rows.length === 0) return null;
  return {
    campaignMessageId: result.rows[0].campaign_message_id,
    campaignId: result.rows[0].campaign_id,
  };
}

export async function attributeInboundResponse(
  tenantId: number,
  tenantSlug: string,
  contactPhone: string,
): Promise<{ attributed: boolean; campaignId?: number }> {
  try {
    const last = await findLastTouchCampaign(tenantId, tenantSlug, contactPhone);
    if (!last) return { attributed: false };

    const tpool = getTenantPool(tenantSlug);
    const stamped = await tpool.query(
      `UPDATE campaign_messages
       SET responded_at = NOW()
       WHERE id = $1 AND responded_at IS NULL
       RETURNING id`,
      [last.campaignMessageId],
    );

    if (stamped.rows.length === 0) {
      return { attributed: false, campaignId: last.campaignId };
    }

    await tpool.query(
      `UPDATE campaigns SET response_count = response_count + 1 WHERE id = $1`,
      [last.campaignId],
    );

    logger.info(
      { tenantId, contactPhone, campaignId: last.campaignId },
      "Campaign attribution: inbound response credited (last-touch, 72hr window)",
    );

    return { attributed: true, campaignId: last.campaignId };
  } catch (err) {
    logger.warn({ err, tenantId, contactPhone }, "attributeInboundResponse failed (non-fatal)");
    return { attributed: false };
  }
}

export async function attributeOptOut(
  tenantId: number,
  tenantSlug: string,
  contactPhone: string,
): Promise<{ attributed: boolean; campaignId?: number }> {
  try {
    const last = await findLastTouchCampaign(tenantId, tenantSlug, contactPhone);
    if (!last) return { attributed: false };

    const tpool = getTenantPool(tenantSlug);
    const updated = await tpool.query(
      `UPDATE opt_outs
       SET campaign_id = $1
       WHERE tenant_id = $2 AND phone_number = $3 AND campaign_id IS NULL
       RETURNING id`,
      [last.campaignId, tenantId, contactPhone],
    );

    if (updated.rows.length === 0) {
      return { attributed: false, campaignId: last.campaignId };
    }

    await tpool.query(
      `UPDATE campaigns SET opt_out_count = opt_out_count + 1 WHERE id = $1`,
      [last.campaignId],
    );

    logger.warn(
      { tenantId, contactPhone, campaignId: last.campaignId },
      "Campaign attribution: opt-out flagged (Smoking Gun — last-touch, 72hr window)",
    );

    return { attributed: true, campaignId: last.campaignId };
  } catch (err) {
    logger.warn({ err, tenantId, contactPhone }, "attributeOptOut failed (non-fatal)");
    return { attributed: false };
  }
}
