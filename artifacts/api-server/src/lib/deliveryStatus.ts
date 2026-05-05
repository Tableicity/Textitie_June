import { db, getTenantPool, tenantsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Twilio delivery-status webhook handler logic.
 *
 * Twilio gives us only `MessageSid` (externalId). campaign_messages now lives
 * per-tenant, so we have to find which tenant schema owns this externalId.
 * We iterate the cached tenant slugs from `public.tenants`. With ~10–100
 * tenants and an index on `campaign_messages.external_id`, this is sub-ms.
 * If we ever scale to thousands of tenants, swap this for a small public
 * lookup table `(external_id PK, tenant_slug)` written at send time.
 */
export type TwilioStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | (string & {});

interface FoundMessage {
  tenantSlug: string;
  campaignMessageId: number;
  campaignId: number;
  currentStatus: string;
}

async function findMessageBySid(externalId: string): Promise<FoundMessage | null> {
  const slugs = await db.select({ slug: tenantsTable.slug }).from(tenantsTable);
  for (const { slug } of slugs) {
    try {
      const tpool = getTenantPool(slug);
      const r = await tpool.query(
        `SELECT id, campaign_id, status FROM campaign_messages WHERE external_id = $1 LIMIT 1`,
        [externalId],
      );
      if (r.rows.length > 0) {
        return {
          tenantSlug: slug,
          campaignMessageId: r.rows[0].id,
          campaignId: r.rows[0].campaign_id,
          currentStatus: r.rows[0].status,
        };
      }
    } catch (err) {
      logger.warn({ err, slug }, "delivery lookup failed for tenant (continuing)");
    }
  }
  return null;
}

export async function processDeliveryStatus(
  externalId: string,
  twilioStatus: TwilioStatus,
  errorCode?: string | null,
  errorMessage?: string | null,
): Promise<{ updated: boolean; campaignId?: number; newStatus?: string }> {
  if (!externalId) return { updated: false };

  const found = await findMessageBySid(externalId);
  if (!found) return { updated: false };

  const { tenantSlug, campaignMessageId, campaignId, currentStatus } = found;
  const tpool = getTenantPool(tenantSlug);
  const status = twilioStatus.toLowerCase();

  if (status === "delivered") {
    if (currentStatus === "delivered" || currentStatus === "failed") {
      return { updated: false, campaignId };
    }
    await tpool.query(
      `UPDATE campaign_messages
       SET status = 'delivered', delivered_at = NOW()
       WHERE id = $1 AND status NOT IN ('delivered', 'failed')`,
      [campaignMessageId],
    );
    await tpool.query(
      `UPDATE campaigns SET delivered_count = delivered_count + 1 WHERE id = $1`,
      [campaignId],
    );
    logger.info(
      { campaignMessageId, campaignId, externalId, tenantSlug },
      "Delivery webhook: message marked delivered",
    );
    return { updated: true, campaignId, newStatus: "delivered" };
  }

  if (status === "undelivered" || status === "failed") {
    if (currentStatus === "delivered" || currentStatus === "failed") {
      return { updated: false, campaignId };
    }
    const errMsg = [errorCode, errorMessage].filter(Boolean).join(": ") || `Twilio status: ${status}`;
    await tpool.query(
      `UPDATE campaign_messages
       SET status = 'failed', error_message = $1
       WHERE id = $2 AND status NOT IN ('delivered', 'failed')`,
      [errMsg, campaignMessageId],
    );
    if (currentStatus === "sent") {
      await tpool.query(
        `UPDATE campaigns SET sent_count = GREATEST(sent_count - 1, 0), failed_count = failed_count + 1 WHERE id = $1`,
        [campaignId],
      );
    } else {
      await tpool.query(
        `UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = $1`,
        [campaignId],
      );
    }
    logger.warn(
      { campaignMessageId, campaignId, externalId, tenantSlug, errorCode, errorMessage },
      "Delivery webhook: message marked failed",
    );
    return { updated: true, campaignId, newStatus: "failed" };
  }

  return { updated: false, campaignId };
}

export function simulateDeliveryCallback(externalId: string, delayMs = 800): void {
  setTimeout(() => {
    processDeliveryStatus(externalId, "delivered").catch((err) => {
      logger.warn({ err, externalId }, "Sim-Vibe delivery callback failed (non-fatal)");
    });
  }, delayMs);
}
