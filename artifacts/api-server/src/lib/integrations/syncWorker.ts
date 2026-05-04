import { db, crmSyncQueueTable, integrationsTable } from "@workspace/db";
import { and, eq, lte, asc, sql } from "drizzle-orm";
import { logger } from "../logger";
import { getHubSpotClient } from "./hubspotStub";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;

function backoffMinutes(attempts: number): number {
  return Math.min(60, Math.pow(2, attempts));
}

export async function enqueueSync(params: {
  tenantId: number;
  provider: "hubspot";
  entityType: "contact" | "conversation";
  entityId: string | number;
  op: "upsert" | "log_activity";
  payload: Record<string, unknown>;
}): Promise<void> {
  const integ = await db
    .select({ status: integrationsTable.status })
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.tenantId, params.tenantId),
        eq(integrationsTable.provider, params.provider),
      ),
    )
    .limit(1);

  if (integ.length === 0 || integ[0].status !== "connected") {
    return;
  }

  await db.insert(crmSyncQueueTable).values({
    tenantId: params.tenantId,
    provider: params.provider,
    entityType: params.entityType,
    entityId: String(params.entityId),
    op: params.op,
    payloadJson: params.payload,
  });
}

export async function processCrmSyncQueue(): Promise<number> {
  const now = new Date();
  const pending = await db
    .select()
    .from(crmSyncQueueTable)
    .where(
      and(
        eq(crmSyncQueueTable.status, "pending"),
        lte(crmSyncQueueTable.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(crmSyncQueueTable.nextAttemptAt))
    .limit(BATCH_SIZE);

  let processed = 0;
  for (const item of pending) {
    const claim = await db
      .update(crmSyncQueueTable)
      .set({ status: "in_flight", updatedAt: new Date() })
      .where(and(eq(crmSyncQueueTable.id, item.id), eq(crmSyncQueueTable.status, "pending")))
      .returning({ id: crmSyncQueueTable.id });
    if (claim.length === 0) continue;

    try {
      let externalId = item.externalId;
      if (item.provider === "hubspot") {
        const client = getHubSpotClient(item.tenantId);
        const payload = item.payloadJson as Record<string, unknown>;
        if (item.entityType === "contact" && item.op === "upsert") {
          const r = await client.upsertContact({
            phone: String(payload.phone ?? ""),
            email: (payload.email as string | null) ?? null,
            firstName: (payload.firstName as string | null) ?? null,
            lastName: (payload.lastName as string | null) ?? null,
            tags: (payload.tags as string[] | undefined) ?? [],
          });
          externalId = r.externalId;
        } else if (item.entityType === "conversation" && item.op === "log_activity") {
          const r = await client.logEngagement({
            externalContactId: String(payload.externalContactId ?? ""),
            type: "NOTE",
            body: String(payload.body ?? ""),
            metadata: (payload.metadata as Record<string, unknown> | undefined) ?? {},
          });
          externalId = r.externalId;
        } else {
          throw new Error(`Unknown op: ${item.entityType}/${item.op}`);
        }
      } else {
        throw new Error(`Unknown provider: ${item.provider}`);
      }

      await db
        .update(crmSyncQueueTable)
        .set({
          status: "done",
          externalId,
          attempts: item.attempts + 1,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(crmSyncQueueTable.id, item.id));

      await db
        .update(integrationsTable)
        .set({ lastSyncAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(
          and(
            eq(integrationsTable.tenantId, item.tenantId),
            eq(integrationsTable.provider, item.provider),
          ),
        );

      processed += 1;
    } catch (err) {
      const nextAttempts = item.attempts + 1;
      const failed = nextAttempts >= MAX_ATTEMPTS;
      const errMsg = err instanceof Error ? err.message : String(err);
      const next = new Date(Date.now() + backoffMinutes(nextAttempts) * 60_000);
      await db
        .update(crmSyncQueueTable)
        .set({
          status: failed ? "failed" : "pending",
          attempts: nextAttempts,
          lastError: errMsg,
          nextAttemptAt: next,
          updatedAt: new Date(),
        })
        .where(eq(crmSyncQueueTable.id, item.id));

      await db
        .update(integrationsTable)
        .set({ lastError: errMsg, updatedAt: new Date() })
        .where(
          and(
            eq(integrationsTable.tenantId, item.tenantId),
            eq(integrationsTable.provider, item.provider),
          ),
        );

      logger.warn({ err, itemId: item.id, attempts: nextAttempts }, "CRM sync item failed");
    }
  }

  // Reset stuck in_flight items older than 5 min back to pending
  await db
    .update(crmSyncQueueTable)
    .set({ status: "pending", updatedAt: new Date() })
    .where(
      and(
        eq(crmSyncQueueTable.status, "in_flight"),
        lte(crmSyncQueueTable.updatedAt, sql`NOW() - INTERVAL '5 minutes'`),
      ),
    );

  return processed;
}
