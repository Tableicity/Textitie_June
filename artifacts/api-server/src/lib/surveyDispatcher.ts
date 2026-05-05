import { randomBytes } from "node:crypto";
import { db, surveysTable, surveySendsTable, tenantsTable } from "@workspace/db";
import { and, eq, lte, isNull, asc } from "drizzle-orm";
import { logger } from "./logger";
import { getSender } from "./senders";
import { checkOutboundCompliance } from "./compliance";

export function generateSurveyToken(): string {
  return randomBytes(18).toString("base64url");
}

export function getPublicBaseUrl(): string {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  const dev = process.env["REPLIT_DEV_DOMAIN"];
  if (dev) return `https://${dev}`;
  return "http://localhost:80";
}

export function buildSurveyUrl(token: string): string {
  return `${getPublicBaseUrl()}/api/s/${token}`;
}

interface EnqueueArgs {
  tenantId: number;
  conversationId: number;
  contactPhone: string;
}

/** Returns the survey_send id, or null if no enqueue happened. */
export async function maybeEnqueueSurveyForClose(args: EnqueueArgs): Promise<number | null> {
  try {
    const surveys = await db
      .select()
      .from(surveysTable)
      .where(and(eq(surveysTable.tenantId, args.tenantId), eq(surveysTable.type, "csat")))
      .limit(1);
    const survey = surveys[0];
    if (!survey || !survey.enabled || !survey.sendAfterClose) return null;

    const compliance = await checkOutboundCompliance(args.tenantId, args.contactPhone);
    if (!compliance.ok) {
      logger.info(
        { tenantId: args.tenantId, conversationId: args.conversationId, reason: compliance.reason },
        "Survey send skipped (compliance)",
      );
      return null;
    }

    const token = generateSurveyToken();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const inserted = await db
      .insert(surveySendsTable)
      .values({
        tenantId: args.tenantId,
        surveyId: survey.id,
        conversationId: args.conversationId,
        contactPhone: args.contactPhone,
        token,
        expiresAt,
        status: "pending",
      })
      .returning();
    return inserted[0]?.id ?? null;
  } catch (err) {
    logger.warn({ err, tenantId: args.tenantId }, "maybeEnqueueSurveyForClose failed");
    return null;
  }
}

/** Process pending survey sends. Called by timer engine. Returns count dispatched. */
export async function processPendingSurveys(): Promise<number> {
  const now = new Date();
  let dispatched = 0;

  const pending = await db
    .select({
      id: surveySendsTable.id,
      tenantId: surveySendsTable.tenantId,
      surveyId: surveySendsTable.surveyId,
      contactPhone: surveySendsTable.contactPhone,
      token: surveySendsTable.token,
      createdAt: surveySendsTable.createdAt,
    })
    .from(surveySendsTable)
    .where(and(eq(surveySendsTable.status, "pending"), isNull(surveySendsTable.sentAt)))
    .orderBy(asc(surveySendsTable.createdAt))
    .limit(50);

  for (const item of pending) {
    try {
      const surveyRows = await db
        .select({
          prompt: surveysTable.prompt,
          enabled: surveysTable.enabled,
          sendDelayMinutes: surveysTable.sendDelayMinutes,
        })
        .from(surveysTable)
        .where(eq(surveysTable.id, item.surveyId))
        .limit(1);
      const survey = surveyRows[0];
      if (!survey || !survey.enabled) continue;

      const earliest = item.createdAt.getTime() + survey.sendDelayMinutes * 60_000;
      if (earliest > now.getTime()) continue;

      // Atomic claim: only one worker can flip pending -> dispatching for this row.
      const claimed = await db
        .update(surveySendsTable)
        .set({ status: "dispatching" })
        .where(and(eq(surveySendsTable.id, item.id), eq(surveySendsTable.status, "pending")))
        .returning({ id: surveySendsTable.id });
      if (claimed.length === 0) continue;

      // Re-check compliance at dispatch time (recipient may have opted out
      // or quiet hours may have changed since enqueue).
      const compliance = await checkOutboundCompliance(item.tenantId, item.contactPhone);
      if (!compliance.ok) {
        await db
          .update(surveySendsTable)
          .set({ status: "failed", error: `compliance: ${compliance.reason}` })
          .where(eq(surveySendsTable.id, item.id));
        logger.info(
          { sendId: item.id, reason: compliance.reason },
          "Survey dispatch blocked by compliance",
        );
        continue;
      }

      const url = buildSurveyUrl(item.token);
      const body = `${survey.prompt} ${url}`;

      const sender = getSender();
      const result = await sender.send({
        to: item.contactPhone,
        body,
        tenantId: item.tenantId,
        conductorAuthorized: false,
      });

      if (result.status === "failed") {
        await db
          .update(surveySendsTable)
          .set({ status: "failed", error: result.responseSummary ?? "send failed" })
          .where(eq(surveySendsTable.id, item.id));
        continue;
      }

      await db
        .update(surveySendsTable)
        .set({ status: "sent", sentAt: now, error: null })
        .where(eq(surveySendsTable.id, item.id));

      dispatched++;
      logger.info(
        { sendId: item.id, tenantId: item.tenantId, externalId: result.externalId },
        "Survey dispatched",
      );
    } catch (err) {
      logger.warn({ err, sendId: item.id }, "Survey send loop error");
      // best-effort: release the claim so the next cycle retries
      try {
        await db
          .update(surveySendsTable)
          .set({ status: "pending" })
          .where(and(eq(surveySendsTable.id, item.id), eq(surveySendsTable.status, "dispatching")));
      } catch {
        // ignore
      }
    }
  }

  // Mark expired
  try {
    await db
      .update(surveySendsTable)
      .set({ status: "expired" })
      .where(
        and(
          eq(surveySendsTable.status, "sent"),
          lte(surveySendsTable.expiresAt, now),
        ),
      );
  } catch (err) {
    logger.warn({ err }, "Survey expire sweep failed");
  }

  return dispatched;
}
