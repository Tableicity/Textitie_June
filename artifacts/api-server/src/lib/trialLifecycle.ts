import {
  db,
  tenantsTable,
  tenantNotificationsTable,
  billingEventsTable,
} from "@workspace/db";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Free-trial lifecycle (Option 1: soft expiry + reminders), driven by the
// timer engine (60s poll). For every tenant still on `subscriptionStatus =
// "trialing"` with a `trialEndsAt`:
//   - 7 days out  -> fire a "7 days left" upgrade nudge (once)
//   - 2 days out  -> fire a "2 days left" upgrade nudge (once)
//   - at/after expiry -> flip status trialing -> "expired" and fire a
//     "trial ended" nudge (once). The Demo Number stays assigned so the
//     tenant keeps its sandbox; the UI swaps in an "Upgrade to keep going"
//     paywall off the "expired" status.
//
// Idempotency: each fire is an INSERT into `tenant_notifications` with a UNIQUE
// (tenant_id, type); ON CONFLICT DO NOTHING means a fire lands exactly once
// even though the processor re-runs every 60s. The status flip is itself
// guarded (only updates rows STILL "trialing") so a payment that flips the
// tenant to "active" in the same window always wins.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialLifecycleAction =
  | "expire"
  | "remind_day_2"
  | "remind_day_7"
  | "none";

/**
 * Pure decision: given the milliseconds remaining until `trialEndsAt`, which
 * single lifecycle action (if any) applies now. Day-7 fires inside the
 * (2, 7]-day window, day-2 inside the (0, 2]-day window, and expiry at <= 0.
 * Only one action is returned per call; earlier windows have already fired
 * (idempotently) on prior cycles, so a tenant that comes online late simply
 * fires the most relevant remaining nudge rather than backfilling old ones.
 */
export function selectTrialAction(msLeft: number): TrialLifecycleAction {
  if (msLeft <= 0) return "expire";
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  if (daysLeft <= 2) return "remind_day_2";
  if (daysLeft <= 7) return "remind_day_7";
  return "none";
}

interface NotificationSpec {
  type: string;
  title: string;
  body: string;
}

const REMINDER_SPECS: Record<
  "remind_day_7" | "remind_day_2" | "expire",
  NotificationSpec
> = {
  remind_day_7: {
    type: "trial_reminder_day_7",
    title: "Your free trial ends in 7 days",
    body: "You have about a week left in your Textitie free trial. Upgrade to a paid plan to keep texting when it ends.",
  },
  remind_day_2: {
    type: "trial_reminder_day_2",
    title: "Your free trial ends in 2 days",
    body: "Only a couple of days left in your Textitie free trial. Upgrade now so your messaging never pauses.",
  },
  expire: {
    type: "trial_expired",
    title: "Your free trial has ended",
    body: "Your Textitie free trial has ended. Upgrade to a paid plan to resume texting — your demo number and setup are saved.",
  },
};

interface TrialTenantRow {
  id: number;
  slug: string;
  name: string;
  trialEndsAt: Date | null;
}

// Minimal slice of the drizzle query surface we need so the helpers below can
// run against EITHER the global `db` or a transaction handle.
type DbLike = Pick<typeof db, "insert">;

/**
 * Insert one trial notification, exactly once per (tenant, type). Returns true
 * only on the first insert (ON CONFLICT DO NOTHING makes a repeat a no-op).
 * Runs against `db` OR a transaction handle, so the caller can make the insert
 * atomic with a status flip.
 */
async function insertTrialNotification(
  executor: DbLike,
  tenant: TrialTenantRow,
  spec: NotificationSpec,
): Promise<boolean> {
  const inserted = await executor
    .insert(tenantNotificationsTable)
    .values({
      tenantId: tenant.id,
      type: spec.type,
      title: spec.title,
      body: spec.body,
      actionUrl: "/billing",
    })
    .onConflictDoNothing({
      target: [tenantNotificationsTable.tenantId, tenantNotificationsTable.type],
    })
    .returning({ id: tenantNotificationsTable.id });

  return inserted.length > 0;
}

/**
 * Best-effort side effects for a first-time notification fire: an auditable
 * billing_events row and the email-delivery seam log (no email provider is
 * wired yet — this log line is where a real send would hook in). A failure
 * here never blocks or rolls back the lifecycle.
 */
async function recordNotificationSideEffects(
  tenant: TrialTenantRow,
  spec: NotificationSpec,
): Promise<void> {
  try {
    await db.insert(billingEventsTable).values({
      tenantId: tenant.id,
      eventType: spec.type,
      metadata: JSON.stringify({ title: spec.title }),
    });
  } catch (err) {
    logger.error({ err, tenantId: tenant.id, type: spec.type }, "trial billing_event insert failed (continuing)");
  }

  logger.info(
    { tenantId: tenant.id, slug: tenant.slug, type: spec.type, emailStub: true },
    `Trial notification: ${spec.title}`,
  );
}

/**
 * Fire a reminder notification (no status change): idempotent insert + (on the
 * first fire) best-effort side effects. Returns true only on the first fire.
 */
async function fireTrialNotification(
  tenant: TrialTenantRow,
  spec: NotificationSpec,
): Promise<boolean> {
  const firstFire = await insertTrialNotification(db, tenant, spec);
  if (firstFire) await recordNotificationSideEffects(tenant, spec);
  return firstFire;
}

/**
 * One timer-engine cycle of the trial lifecycle. Returns the number of actions
 * taken (reminders fired + expirations) for log visibility. Per-tenant errors
 * are caught so one bad row can never stall the whole cycle.
 */
export async function processTrialLifecycle(
  now: Date = new Date(),
): Promise<number> {
  const trialing = await db
    .select({
      id: tenantsTable.id,
      slug: tenantsTable.slug,
      name: tenantsTable.name,
      trialEndsAt: tenantsTable.trialEndsAt,
    })
    .from(tenantsTable)
    .where(
      and(
        eq(tenantsTable.subscriptionStatus, "trialing"),
        isNotNull(tenantsTable.trialEndsAt),
      ),
    );

  let actions = 0;
  for (const tenant of trialing) {
    if (!tenant.trialEndsAt) continue;
    const msLeft = tenant.trialEndsAt.getTime() - now.getTime();
    const action = selectTrialAction(msLeft);

    try {
      if (action === "expire") {
        // Atomic flip + fire. The UPDATE is doubly guarded — still "trialing"
        // AND trialEndsAt actually elapsed — so neither a concurrent upgrade to
        // "active" nor a concurrent trial EXTENSION (which keeps status
        // "trialing" but pushes trialEndsAt into the future) is clobbered by a
        // stale processor. Wrapping the flip and the "expired" notification in
        // one transaction guarantees the notification can never be skipped after
        // a successful flip: if the insert throws, the flip rolls back and the
        // next cycle retries both.
        let firstFire = false;
        const flipped = await db.transaction(async (tx) => {
          const updated = await tx
            .update(tenantsTable)
            .set({ subscriptionStatus: "expired" })
            .where(
              and(
                eq(tenantsTable.id, tenant.id),
                eq(tenantsTable.subscriptionStatus, "trialing"),
                lte(tenantsTable.trialEndsAt, now),
              ),
            )
            .returning({ id: tenantsTable.id });

          if (updated.length === 0) return false;
          firstFire = await insertTrialNotification(tx, tenant, REMINDER_SPECS.expire);
          return true;
        });

        if (flipped) {
          if (firstFire) await recordNotificationSideEffects(tenant, REMINDER_SPECS.expire);
          logger.info({ tenantId: tenant.id, slug: tenant.slug }, "Trial expired: status set to 'expired'");
          actions++;
        }
      } else if (action === "remind_day_2") {
        if (await fireTrialNotification(tenant, REMINDER_SPECS.remind_day_2)) actions++;
      } else if (action === "remind_day_7") {
        if (await fireTrialNotification(tenant, REMINDER_SPECS.remind_day_7)) actions++;
      }
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "trial lifecycle failed for tenant (continuing)");
    }
  }

  return actions;
}
