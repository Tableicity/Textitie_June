import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Last-Touch Attribution within a 72-hour window.
 *
 * When a contact replies to or opts out of a campaign, attribute the action
 * to the MOST RECENT campaign message that was sent to that contact within
 * the last 72 hours. This prevents:
 *  - Random "thank you" replies weeks later from skewing campaign ROI
 *  - Multi-campaign double-counting (Monday's "Discount" vs Tuesday's "Greeting")
 */

const ATTRIBUTION_WINDOW_HOURS = 72;

interface AttributedCampaign {
  campaignMessageId: number;
  campaignId: number;
}

/**
 * Find the most recent campaign message sent to this contact within the
 * attribution window. Returns null if no recent campaign exists.
 */
async function findLastTouchCampaign(
  tenantId: number,
  contactPhone: string,
): Promise<AttributedCampaign | null> {
  const result = await pool.query(
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

/**
 * Attribute an inbound reply to the most recent campaign sent to this contact
 * within 72 hours. Increments campaigns.response_count and stamps
 * campaign_messages.responded_at (only on first response — idempotent).
 */
export async function attributeInboundResponse(
  tenantId: number,
  contactPhone: string,
): Promise<{ attributed: boolean; campaignId?: number }> {
  try {
    const last = await findLastTouchCampaign(tenantId, contactPhone);
    if (!last) return { attributed: false };

    // Idempotent: only mark responded_at once
    const stamped = await pool.query(
      `UPDATE campaign_messages
       SET responded_at = NOW()
       WHERE id = $1 AND responded_at IS NULL
       RETURNING id`,
      [last.campaignMessageId],
    );

    if (stamped.rows.length === 0) {
      // Already counted — don't double-increment
      return { attributed: false, campaignId: last.campaignId };
    }

    await pool.query(
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

/**
 * Attribute an opt-out (STOP/UNSUBSCRIBE) to the campaign that triggered it.
 * Updates the opt_outs row's campaign_id (the "Smoking Gun") AND increments
 * campaigns.opt_out_count.
 *
 * Must be called AFTER the opt_outs row is inserted.
 */
export async function attributeOptOut(
  tenantId: number,
  contactPhone: string,
): Promise<{ attributed: boolean; campaignId?: number }> {
  try {
    const last = await findLastTouchCampaign(tenantId, contactPhone);
    if (!last) return { attributed: false };

    const updated = await pool.query(
      `UPDATE opt_outs
       SET campaign_id = $1
       WHERE tenant_id = $2 AND phone_number = $3 AND campaign_id IS NULL
       RETURNING id`,
      [last.campaignId, tenantId, contactPhone],
    );

    if (updated.rows.length === 0) {
      return { attributed: false, campaignId: last.campaignId };
    }

    await pool.query(
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
