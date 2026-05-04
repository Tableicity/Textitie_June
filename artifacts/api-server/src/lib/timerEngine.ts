import { db, automationRulesTable, conversationsTable, messagesTable, conversationEventsTable } from "@workspace/db";
import { eq, and, lt, asc, sql } from "drizzle-orm";
import { pool } from "@workspace/db";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 60_000;

interface TimerTriggerConfig {
  inactiveHours?: number;
}

interface TimerActionConfig {
  replyBody?: string;
}

export function startTimerEngine(): void {
  logger.info("Timer engine started (polling every 60s)");
  setInterval(() => {
    runTimerCycle().catch((err) => {
      logger.error({ err }, "Timer engine cycle error");
    });
  }, POLL_INTERVAL_MS);
}

async function runTimerCycle(): Promise<void> {
  await processFollowUpTimers();
  await processAutoResolve();
}

async function processFollowUpTimers(): Promise<void> {
  const rules = await db
    .select()
    .from(automationRulesTable)
    .where(
      and(
        eq(automationRulesTable.type, "follow_up_timer"),
        eq(automationRulesTable.enabled, true),
      ),
    )
    .orderBy(asc(automationRulesTable.priority));

  for (const rule of rules) {
    const trigger = rule.triggerConfig as TimerTriggerConfig;
    const action = rule.actionConfig as TimerActionConfig;
    if (!trigger.inactiveHours || !action.replyBody) continue;

    const cutoff = new Date(Date.now() - trigger.inactiveHours * 60 * 60 * 1000);

    const staleConversations = await db
      .select({
        id: conversationsTable.id,
        tenantId: conversationsTable.tenantId,
        lastMessageAt: conversationsTable.lastMessageAt,
      })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.tenantId, rule.tenantId),
          eq(conversationsTable.status, "open"),
          lt(conversationsTable.lastMessageAt, cutoff),
        ),
      );

    for (const conv of staleConversations) {
      const alreadySent = await pool.query(
        `SELECT 1 FROM conversation_events
         WHERE conversation_id = $1
           AND event_type = 'automation_fired'
           AND metadata::text LIKE $2
         LIMIT 1`,
        [conv.id, `%"ruleId":${rule.id}%`],
      );

      if ((alreadySent.rowCount ?? 0) > 0) continue;

      await db.insert(messagesTable).values({
        conversationId: conv.id,
        direction: "outbound",
        body: action.replyBody,
        senderName: "System (Auto)",
        read: true,
      });

      const now = new Date();
      await db
        .update(conversationsTable)
        .set({ lastMessageAt: now })
        .where(eq(conversationsTable.id, conv.id));

      await db.insert(conversationEventsTable).values({
        conversationId: conv.id,
        eventType: "automation_fired",
        note: `Follow-up sent after ${trigger.inactiveHours}h inactivity (rule: ${rule.name})`,
        metadata: JSON.stringify({ ruleId: rule.id, ruleType: "follow_up_timer" }),
      });

      logger.info({ conversationId: conv.id, ruleId: rule.id }, "Follow-up timer fired");
    }
  }
}

async function processAutoResolve(): Promise<void> {
  const rules = await db
    .select()
    .from(automationRulesTable)
    .where(
      and(
        eq(automationRulesTable.type, "auto_resolve"),
        eq(automationRulesTable.enabled, true),
      ),
    )
    .orderBy(asc(automationRulesTable.priority));

  for (const rule of rules) {
    const trigger = rule.triggerConfig as TimerTriggerConfig;
    if (!trigger.inactiveHours) continue;

    const cutoff = new Date(Date.now() - trigger.inactiveHours * 60 * 60 * 1000);

    const staleConversations = await db
      .select({
        id: conversationsTable.id,
        tenantId: conversationsTable.tenantId,
      })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.tenantId, rule.tenantId),
          eq(conversationsTable.status, "open"),
          lt(conversationsTable.lastMessageAt, cutoff),
        ),
      );

    for (const conv of staleConversations) {
      await db
        .update(conversationsTable)
        .set({ status: "closed" })
        .where(
          and(
            eq(conversationsTable.id, conv.id),
            eq(conversationsTable.status, "open"),
          ),
        );

      const action = (rule.actionConfig as TimerActionConfig);
      if (action.replyBody) {
        await db.insert(messagesTable).values({
          conversationId: conv.id,
          direction: "outbound",
          body: action.replyBody,
          senderName: "System (Auto)",
          read: true,
        });
      }

      await db.insert(conversationEventsTable).values({
        conversationId: conv.id,
        eventType: "auto_resolved",
        note: `Auto-resolved after ${trigger.inactiveHours}h inactivity (rule: ${rule.name})`,
        metadata: JSON.stringify({ ruleId: rule.id, ruleType: "auto_resolve" }),
      });

      logger.info({ conversationId: conv.id, ruleId: rule.id }, "Conversation auto-resolved");
    }
  }
}
