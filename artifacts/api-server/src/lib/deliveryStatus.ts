import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Twilio delivery-status webhook handler logic.
 * Maps Twilio MessageStatus values onto our internal campaign_messages.status
 * and bumps the campaigns.delivered_count / failed_count counters atomically.
 *
 * Twilio MessageStatus values we care about:
 *   - "delivered"           → message landed on handset
 *   - "undelivered"         → carrier rejected (e.g. invalid number)
 *   - "failed"              → terminal failure
 *   - "sent" / "queued"     → in-flight, ignored (we already track these)
 */
export type TwilioStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | (string & {});

export async function processDeliveryStatus(
  externalId: string,
  twilioStatus: TwilioStatus,
  errorCode?: string | null,
  errorMessage?: string | null,
): Promise<{ updated: boolean; campaignId?: number; newStatus?: string }> {
  if (!externalId) return { updated: false };

  const found = await pool.query(
    `SELECT id, campaign_id, status FROM campaign_messages WHERE external_id = $1 LIMIT 1`,
    [externalId],
  );
  if (found.rows.length === 0) return { updated: false };

  const row = found.rows[0];
  const campaignMessageId: number = row.id;
  const campaignId: number = row.campaign_id;
  const currentStatus: string = row.status;

  const status = twilioStatus.toLowerCase();

  // Terminal "delivered" — only flip if not already terminal
  if (status === "delivered") {
    if (currentStatus === "delivered" || currentStatus === "failed") {
      return { updated: false, campaignId };
    }
    await pool.query(
      `UPDATE campaign_messages
       SET status = 'delivered', delivered_at = NOW()
       WHERE id = $1 AND status NOT IN ('delivered', 'failed')`,
      [campaignMessageId],
    );
    await pool.query(
      `UPDATE campaigns SET delivered_count = delivered_count + 1 WHERE id = $1`,
      [campaignId],
    );
    logger.info(
      { campaignMessageId, campaignId, externalId },
      "Delivery webhook: message marked delivered",
    );
    return { updated: true, campaignId, newStatus: "delivered" };
  }

  // Terminal failure paths
  if (status === "undelivered" || status === "failed") {
    if (currentStatus === "delivered" || currentStatus === "failed") {
      return { updated: false, campaignId };
    }
    const errMsg = [errorCode, errorMessage].filter(Boolean).join(": ") || `Twilio status: ${status}`;
    await pool.query(
      `UPDATE campaign_messages
       SET status = 'failed', error_message = $1
       WHERE id = $2 AND status NOT IN ('delivered', 'failed')`,
      [errMsg, campaignMessageId],
    );
    // Decrement sent_count if we previously counted it as sent, then bump failed
    if (currentStatus === "sent") {
      await pool.query(
        `UPDATE campaigns SET sent_count = GREATEST(sent_count - 1, 0), failed_count = failed_count + 1 WHERE id = $1`,
        [campaignId],
      );
    } else {
      await pool.query(
        `UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = $1`,
        [campaignId],
      );
    }
    logger.warn(
      { campaignMessageId, campaignId, externalId, errorCode, errorMessage },
      "Delivery webhook: message marked failed",
    );
    return { updated: true, campaignId, newStatus: "failed" };
  }

  // Non-terminal statuses (queued/sent) — no-op
  return { updated: false, campaignId };
}

/**
 * Sim-Vibe: simulate a Twilio delivery-status callback for the StubSender.
 * Called by the campaign engine immediately after a stubbed send so we can
 * see the "Delivered" counter move during local testing.
 */
export function simulateDeliveryCallback(externalId: string, delayMs = 800): void {
  setTimeout(() => {
    processDeliveryStatus(externalId, "delivered").catch((err) => {
      logger.warn({ err, externalId }, "Sim-Vibe delivery callback failed (non-fatal)");
    });
  }, delayMs);
}
