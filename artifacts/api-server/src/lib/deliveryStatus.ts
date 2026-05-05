import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { describeTwilioError } from "./twilioErrors";

/**
 * Twilio delivery-status webhook handler logic.
 *
 * Twilio gives us only `MessageSid` (the externalId we recorded at send
 * time). We look it up in two places:
 *
 *   1. `public.messages.external_id` — every outbound conversation reply
 *      and automation auto-reply lives here.
 *   2. `public.campaign_messages.external_id` — bulk SMS campaign sends.
 *
 * Both writes happen against the global pool with explicit tenant scoping
 * (Stage 4 schema-per-tenant is deferred — see replit.md).
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
  /**
   * Internal `messages.id` from the status-callback URL `?msgId=` query
   * param. When provided, we look up the row by PK first (race-free) and
   * skip the externalId scan entirely. Falls back to externalId for
   * campaign messages and for any pre-existing rows that lack a msgId.
   */
  messageId?: number,
): Promise<{
  updated: boolean;
  target?: "message" | "campaign_message";
  campaignId?: number;
  newStatus?: string;
}> {
  if (!externalId && !messageId) return { updated: false };

  const status = twilioStatus.toLowerCase();
  const isTerminalSuccess = status === "delivered";
  const isTerminalFailure = status === "undelivered" || status === "failed";

  // ------------------------------------------------------------------
  // 1. Conversation messages (public.messages)
  //    Prefer PK lookup (msgId from callback URL) — race-free.
  //    Fall back to external_id for legacy rows or alternate flows.
  // ------------------------------------------------------------------
  const msgRows = messageId
    ? await db.execute<{ id: number; status: string; conversation_id: number }>(
        sql`SELECT id, status, conversation_id FROM messages WHERE id = ${messageId} LIMIT 1`,
      )
    : await db.execute<{ id: number; status: string; conversation_id: number }>(
        sql`SELECT id, status, conversation_id FROM messages WHERE external_id = ${externalId} LIMIT 1`,
      );
  const msg = msgRows.rows[0];

  if (msg) {
    if (msg.status === "delivered" || msg.status === "failed") {
      return { updated: false, target: "message" };
    }
    if (isTerminalSuccess) {
      await db.execute(sql`
        UPDATE messages
           SET status = 'delivered', delivered_at = NOW()
         WHERE id = ${msg.id}
           AND status NOT IN ('delivered', 'failed')
      `);
      logger.info(
        { messageId: msg.id, externalId, conversationId: msg.conversation_id },
        "Delivery webhook: conversation message marked delivered",
      );
      return { updated: true, target: "message", newStatus: "delivered" };
    }
    if (isTerminalFailure) {
      const code = errorCode ?? null;
      const errMsg = describeTwilioError(errorCode, errorMessage, status);
      await db.execute(sql`
        UPDATE messages
           SET status = 'failed',
               error_code = ${code},
               error_message = ${errMsg}
         WHERE id = ${msg.id}
           AND status NOT IN ('delivered', 'failed')
      `);
      logger.warn(
        {
          messageId: msg.id,
          externalId,
          conversationId: msg.conversation_id,
          errorCode,
          errorMessage,
        },
        "Delivery webhook: conversation message marked failed",
      );
      return { updated: true, target: "message", newStatus: "failed" };
    }
    // Non-terminal status (queued/sent) — nothing to persist for messages.
    return { updated: false, target: "message" };
  }

  // ------------------------------------------------------------------
  // 2. Campaign messages (public.campaign_messages)
  // ------------------------------------------------------------------
  const cmRows = await db.execute<{
    id: number;
    campaign_id: number;
    status: string;
  }>(
    sql`SELECT id, campaign_id, status FROM campaign_messages WHERE external_id = ${externalId} LIMIT 1`,
  );
  const cm = cmRows.rows[0];

  if (!cm) return { updated: false };

  const { id: campaignMessageId, campaign_id: campaignId, status: currentStatus } = cm;

  if (currentStatus === "delivered" || currentStatus === "failed") {
    return { updated: false, target: "campaign_message", campaignId };
  }

  if (isTerminalSuccess) {
    await db.execute(sql`
      UPDATE campaign_messages
         SET status = 'delivered', delivered_at = NOW()
       WHERE id = ${campaignMessageId}
         AND status NOT IN ('delivered', 'failed')
    `);
    await db.execute(
      sql`UPDATE campaigns SET delivered_count = delivered_count + 1 WHERE id = ${campaignId}`,
    );
    logger.info(
      { campaignMessageId, campaignId, externalId },
      "Delivery webhook: campaign message marked delivered",
    );
    return { updated: true, target: "campaign_message", campaignId, newStatus: "delivered" };
  }

  if (isTerminalFailure) {
    const errMsg = describeTwilioError(errorCode, errorMessage, status);
    await db.execute(sql`
      UPDATE campaign_messages
         SET status = 'failed', error_message = ${errMsg}
       WHERE id = ${campaignMessageId}
         AND status NOT IN ('delivered', 'failed')
    `);
    if (currentStatus === "sent") {
      await db.execute(sql`
        UPDATE campaigns
           SET sent_count = GREATEST(sent_count - 1, 0),
               failed_count = failed_count + 1
         WHERE id = ${campaignId}
      `);
    } else {
      await db.execute(
        sql`UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ${campaignId}`,
      );
    }
    logger.warn(
      { campaignMessageId, campaignId, externalId, errorCode, errorMessage },
      "Delivery webhook: campaign message marked failed",
    );
    return { updated: true, target: "campaign_message", campaignId, newStatus: "failed" };
  }

  return { updated: false, target: "campaign_message", campaignId };
}

export function simulateDeliveryCallback(externalId: string, delayMs = 800): void {
  setTimeout(() => {
    processDeliveryStatus(externalId, "delivered").catch((err) => {
      logger.warn({ err, externalId }, "Sim-Vibe delivery callback failed (non-fatal)");
    });
  }, delayMs);
}
