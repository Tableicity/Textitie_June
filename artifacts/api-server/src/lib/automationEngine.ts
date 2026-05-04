import { db, automationRulesTable, optOutsTable, conversationsTable, messagesTable, conversationEventsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { pool } from "@workspace/db";
import { logger } from "./logger";

const TCPA_KEYWORDS = ["stop", "end", "unsubscribe", "cancel", "quit"];

const TCPA_CONFIRMATION = "You have been unsubscribed and will no longer receive messages from us. Reply START to re-subscribe.";

interface TriggerConfig {
  keywords?: string[];
  matchType?: "exact" | "contains" | "regex";
}

interface ActionConfig {
  replyBody?: string;
}

export async function processInboundMessage(
  tenantId: number,
  conversationId: number,
  contactPhone: string,
  messageBody: string,
): Promise<{ handled: boolean; action?: string }> {
  try {
    const normalized = messageBody.trim().toLowerCase();
    if (normalized === "start") {
      const resubscribed = await handleResubscribe(tenantId, contactPhone);
      if (resubscribed) {
        await db.insert(messagesTable).values({
          conversationId,
          direction: "outbound",
          body: "You have been re-subscribed and will receive messages again. Welcome back!",
          senderName: "System (Auto)",
          read: true,
        });
        await db.insert(conversationEventsTable).values({
          conversationId,
          eventType: "resubscribed",
          note: "Contact sent START — re-subscribed",
        });
        return { handled: true, action: "resubscribed" };
      }
    }

    const isOptedOut = await checkOptOut(tenantId, contactPhone);
    if (isOptedOut) {
      logger.info({ tenantId, contactPhone }, "Message from opted-out number, ignoring");
      return { handled: true, action: "opted_out_ignored" };
    }

    const tcpaResult = await handleTcpaKeyword(tenantId, conversationId, contactPhone, messageBody);
    if (tcpaResult.handled) {
      return tcpaResult;
    }

    const messageCount = await pool.query(
      `SELECT count(*)::int as cnt FROM messages WHERE conversation_id = $1`,
      [conversationId],
    );
    const isFirstMessage = (messageCount.rows[0]?.cnt ?? 0) <= 1;

    if (isFirstMessage) {
      const welcomeResult = await handleWelcomeMessage(tenantId, conversationId);
      if (welcomeResult.handled) {
        return welcomeResult;
      }
    }

    const keywordResult = await handleKeywordAutoreply(tenantId, conversationId, messageBody);
    if (keywordResult.handled) {
      return keywordResult;
    }

    return { handled: false };
  } catch (err) {
    logger.error({ err, tenantId, conversationId }, "Automation engine error (non-fatal)");
    return { handled: false };
  }
}

async function checkOptOut(tenantId: number, phoneNumber: string): Promise<boolean> {
  const rows = await db
    .select({ id: optOutsTable.id })
    .from(optOutsTable)
    .where(and(eq(optOutsTable.tenantId, tenantId), eq(optOutsTable.phoneNumber, phoneNumber)))
    .limit(1);
  return rows.length > 0;
}

async function handleTcpaKeyword(
  tenantId: number,
  conversationId: number,
  contactPhone: string,
  messageBody: string,
): Promise<{ handled: boolean; action?: string }> {
  const normalized = messageBody.trim().toLowerCase();
  if (!TCPA_KEYWORDS.includes(normalized)) {
    return { handled: false };
  }

  await pool.query(
    `INSERT INTO opt_outs (tenant_id, phone_number, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, phone_number) DO NOTHING`,
    [tenantId, contactPhone, `Keyword: ${normalized}`],
  );

  await db.insert(messagesTable).values({
    conversationId,
    direction: "outbound",
    body: TCPA_CONFIRMATION,
    senderName: "System (Auto)",
    read: true,
  });

  const now = new Date();
  await db
    .update(conversationsTable)
    .set({ status: "closed", lastMessageAt: now })
    .where(eq(conversationsTable.id, conversationId));

  await db.insert(conversationEventsTable).values({
    conversationId,
    eventType: "auto_unsubscribed",
    note: `Contact sent "${normalized}" — TCPA opt-out processed`,
  });

  logger.info({ tenantId, contactPhone, keyword: normalized }, "TCPA opt-out processed");
  return { handled: true, action: "tcpa_opt_out" };
}

async function handleWelcomeMessage(
  tenantId: number,
  conversationId: number,
): Promise<{ handled: boolean; action?: string }> {
  const rules = await db
    .select()
    .from(automationRulesTable)
    .where(
      and(
        eq(automationRulesTable.tenantId, tenantId),
        eq(automationRulesTable.type, "welcome_message"),
        eq(automationRulesTable.enabled, true),
      ),
    )
    .orderBy(asc(automationRulesTable.priority))
    .limit(1);

  if (rules.length === 0) return { handled: false };

  const rule = rules[0];
  const action = rule.actionConfig as ActionConfig;
  if (!action.replyBody) return { handled: false };

  await db.insert(messagesTable).values({
    conversationId,
    direction: "outbound",
    body: action.replyBody,
    senderName: "System (Auto)",
    read: true,
  });

  const now = new Date();
  await db
    .update(conversationsTable)
    .set({ lastMessageAt: now })
    .where(eq(conversationsTable.id, conversationId));

  await db.insert(conversationEventsTable).values({
    conversationId,
    eventType: "automation_fired",
    note: `Welcome message sent (rule: ${rule.name})`,
    metadata: JSON.stringify({ ruleId: rule.id, ruleType: "welcome_message" }),
  });

  logger.info({ tenantId, conversationId, ruleId: rule.id }, "Welcome message sent");
  return { handled: true, action: "welcome_message" };
}

async function handleKeywordAutoreply(
  tenantId: number,
  conversationId: number,
  messageBody: string,
): Promise<{ handled: boolean; action?: string }> {
  const rules = await db
    .select()
    .from(automationRulesTable)
    .where(
      and(
        eq(automationRulesTable.tenantId, tenantId),
        eq(automationRulesTable.type, "keyword_reply"),
        eq(automationRulesTable.enabled, true),
      ),
    )
    .orderBy(asc(automationRulesTable.priority));

  if (rules.length === 0) return { handled: false };

  const normalized = messageBody.trim().toLowerCase();

  for (const rule of rules) {
    const trigger = rule.triggerConfig as TriggerConfig;
    const action = rule.actionConfig as ActionConfig;
    if (!trigger.keywords || trigger.keywords.length === 0 || !action.replyBody) continue;

    const matchType = trigger.matchType ?? "contains";
    let matched = false;

    for (const keyword of trigger.keywords) {
      const kw = keyword.toLowerCase();
      if (matchType === "exact" && normalized === kw) {
        matched = true;
        break;
      } else if (matchType === "contains" && normalized.includes(kw)) {
        matched = true;
        break;
      } else if (matchType === "regex") {
        try {
          const re = new RegExp(kw, "i");
          if (re.test(messageBody)) {
            matched = true;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (matched) {
      await db.insert(messagesTable).values({
        conversationId,
        direction: "outbound",
        body: action.replyBody,
        senderName: "System (Auto)",
        read: true,
      });

      const now = new Date();
      await db
        .update(conversationsTable)
        .set({ lastMessageAt: now })
        .where(eq(conversationsTable.id, conversationId));

      await db.insert(conversationEventsTable).values({
        conversationId,
        eventType: "automation_fired",
        note: `Keyword auto-reply triggered (rule: ${rule.name})`,
        metadata: JSON.stringify({ ruleId: rule.id, ruleType: "keyword_reply" }),
      });

      logger.info({ tenantId, conversationId, ruleId: rule.id, ruleName: rule.name }, "Keyword auto-reply sent");
      return { handled: true, action: "keyword_reply" };
    }
  }

  return { handled: false };
}

export async function handleResubscribe(
  tenantId: number,
  contactPhone: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM opt_outs WHERE tenant_id = $1 AND phone_number = $2`,
    [tenantId, contactPhone],
  );
  const removed = (result.rowCount ?? 0) > 0;
  if (removed) {
    logger.info({ tenantId, contactPhone }, "Contact re-subscribed (START keyword)");
  }
  return removed;
}
