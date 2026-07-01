import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  tenantsTable,
  billingEventsTable,
  creditLedgerTable,
  creditAutoRechargeAttemptsTable,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// DB-backed suite for the auto-recharge worker (real test DB). Only the Stripe
// money-movement seam (`chargeBackupTopupOffSession`) is mocked — everything
// else (claim under FOR UPDATE, attempts table, breaker, grantBackupCredits) is
// asserted against the real database. The block constants stay real.
// ---------------------------------------------------------------------------

vi.mock("./backupTopupProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backupTopupProvider")>();
  return { ...actual, chargeBackupTopupOffSession: vi.fn() };
});

const { chargeBackupTopupOffSession } = await import("./backupTopupProvider");
const {
  maybeTriggerAutoRecharge,
  reconcileAutoRecharge,
  updateAutoRechargeSettings,
  getAutoRechargeSettings,
  AutoRechargeValidationError,
} = await import("./autoRecharge");

const charge = vi.mocked(chargeBackupTopupOffSession);

const RUN = `autorecharge-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const createdTenantIds: number[] = [];
let seq = 0;

interface MakeOpts {
  enabled?: boolean;
  threshold?: number;
  amount?: number;
  pmId?: string | null;
  customerId?: string | null;
  addon?: number;
  backup?: number;
  cap?: number;
  suspendedAt?: Date | null;
  declineCount?: number;
}

async function makeTenant(opts: MakeOpts = {}): Promise<number> {
  seq += 1;
  const [t] = await db
    .insert(tenantsTable)
    .values({
      slug: `${RUN}-${seq}`,
      name: `AutoRecharge ${RUN}-${seq}`,
      region: "us",
      tierCode: "starter",
      planTierCode: "starter",
      phoneNumber: `+1988${String(Date.now()).slice(-4)}${String(seq).padStart(3, "0")}`,
      stripeCustomerId: opts.customerId === undefined ? "cus_test_autorecharge" : opts.customerId,
      addonCredits: opts.addon ?? 0,
      backupCredits: opts.backup ?? 0,
      creditBucketsMigratedAt: new Date(),
      backupTopupCapPerCycle: opts.cap ?? 4,
      autoRechargeEnabled: opts.enabled ?? true,
      autoRechargeThresholdCredits: opts.threshold ?? 0,
      autoRechargeAmountCredits: opts.amount ?? 250,
      autoRechargePaymentMethodId:
        opts.pmId === undefined ? "pm_test_card" : opts.pmId,
      autoRechargeSuspendedAt: opts.suspendedAt ?? null,
      autoRechargeDeclineCount: opts.declineCount ?? 0,
    })
    .returning({ id: tenantsTable.id });
  createdTenantIds.push(t.id);
  return t.id;
}

async function readTenant(id: number) {
  const [t] = await db
    .select({
      backupCredits: tenantsTable.backupCredits,
      declineCount: tenantsTable.autoRechargeDeclineCount,
      suspendedAt: tenantsTable.autoRechargeSuspendedAt,
      nextRetryAt: tenantsTable.autoRechargeNextRetryAt,
      lastSuccessAt: tenantsTable.autoRechargeLastSuccessAt,
      lastFailureReason: tenantsTable.autoRechargeLastFailureReason,
      lastAttemptAt: tenantsTable.autoRechargeLastAttemptAt,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, id));
  return t;
}

async function attempts(tenantId: number) {
  return db
    .select()
    .from(creditAutoRechargeAttemptsTable)
    .where(eq(creditAutoRechargeAttemptsTable.tenantId, tenantId));
}

async function billingEvents(tenantId: number, eventType: string) {
  const typed = await pool.query(
    `SELECT id FROM billing_events WHERE tenant_id = $1 AND event_type = $2`,
    [tenantId, eventType],
  );
  return typed.rowCount ?? 0;
}

beforeEach(() => {
  charge.mockReset();
  // Benign default so the reconcile sweep over other tenants can't explode.
  charge.mockResolvedValue({
    authorized: true,
    paymentIntentId: `pi_default_${Math.random().toString(36).slice(2)}`,
    credits: 250,
    amountCents: 1000,
    hardDecline: false,
  });
});

afterEach(async () => {
  // Disable every tenant this suite created so a later test's reconcile sweep
  // never re-charges them.
  if (createdTenantIds.length) {
    await db
      .update(tenantsTable)
      .set({ autoRechargeEnabled: false })
      .where(inArray(tenantsTable.id, createdTenantIds));
  }
});

afterAll(async () => {
  if (!createdTenantIds.length) return;
  await db
    .delete(creditAutoRechargeAttemptsTable)
    .where(inArray(creditAutoRechargeAttemptsTable.tenantId, createdTenantIds));
  await db.delete(creditLedgerTable).where(inArray(creditLedgerTable.tenantId, createdTenantIds));
  await db.delete(billingEventsTable).where(inArray(billingEventsTable.tenantId, createdTenantIds));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, createdTenantIds));
});

describe("maybeTriggerAutoRecharge — happy path", () => {
  it("charges off-session, grants backup credits, and writes a succeeded attempt", async () => {
    const tenantId = await makeTenant({ threshold: 0, amount: 250, backup: 0 });
    charge.mockResolvedValueOnce({
      authorized: true,
      paymentIntentId: "pi_happy_1",
      credits: 250,
      amountCents: 1000,
      hardDecline: false,
    });

    await maybeTriggerAutoRecharge(tenantId);

    expect(charge).toHaveBeenCalledTimes(1);
    const call = charge.mock.calls[0][0];
    expect(call.blocks).toBe(1);
    expect(call.idempotencyKey).toMatch(new RegExp(`^auto_recharge:${tenantId}:`));

    const t = await readTenant(tenantId);
    expect(t.backupCredits).toBe(250);
    expect(t.declineCount).toBe(0);
    expect(t.lastSuccessAt).not.toBeNull();

    const rows = await attempts(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("succeeded");
    expect(rows[0].paymentIntentId).toBe("pi_happy_1");
    expect(await billingEvents(tenantId, "auto_recharge_succeeded")).toBe(1);
  });
});

describe("maybeTriggerAutoRecharge — eligibility gates (no charge)", () => {
  it("skips a disabled tenant", async () => {
    const tenantId = await makeTenant({ enabled: false });
    await maybeTriggerAutoRecharge(tenantId);
    expect(charge).not.toHaveBeenCalled();
    expect(await attempts(tenantId)).toHaveLength(0);
  });

  it("skips a tenant with no saved card", async () => {
    const tenantId = await makeTenant({ pmId: null });
    await maybeTriggerAutoRecharge(tenantId);
    expect(charge).not.toHaveBeenCalled();
    expect(await attempts(tenantId)).toHaveLength(0);
  });

  it("skips when the balance is above the threshold", async () => {
    const tenantId = await makeTenant({ threshold: 100, addon: 1000 });
    await maybeTriggerAutoRecharge(tenantId);
    expect(charge).not.toHaveBeenCalled();
    expect(await attempts(tenantId)).toHaveLength(0);
  });

  it("skips a suspended tenant", async () => {
    const tenantId = await makeTenant({ suspendedAt: new Date() });
    await maybeTriggerAutoRecharge(tenantId);
    expect(charge).not.toHaveBeenCalled();
    expect(await attempts(tenantId)).toHaveLength(0);
  });

  it("skips when the per-cycle cap leaves 0 blocks", async () => {
    const tenantId = await makeTenant({ cap: 0 });
    await maybeTriggerAutoRecharge(tenantId);
    expect(charge).not.toHaveBeenCalled();
    expect(await attempts(tenantId)).toHaveLength(0);
  });

  it("skips a tenant with a stub Stripe customer (never charges a fake customer)", async () => {
    const tenantId = await makeTenant({ customerId: "cus_stub_x" });
    await maybeTriggerAutoRecharge(tenantId);
    // No real customer → executeClaim fails closed BEFORE charging.
    expect(charge).not.toHaveBeenCalled();
    const rows = await attempts(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].failureReason).toBe("missing_stripe_customer");
  });
});

describe("maybeTriggerAutoRecharge — cooldown (exactly one recharge per low episode)", () => {
  it("does not start a second attempt while still within the cooldown", async () => {
    const tenantId = await makeTenant({ threshold: 1000, amount: 250, backup: 0 });
    charge.mockResolvedValue({
      authorized: true,
      paymentIntentId: `pi_cd_${Math.random().toString(36).slice(2)}`,
      credits: 250,
      amountCents: 1000,
      hardDecline: false,
    });

    await maybeTriggerAutoRecharge(tenantId); // claims + charges
    await maybeTriggerAutoRecharge(tenantId); // still low, but cooling down

    expect(charge).toHaveBeenCalledTimes(1);
    expect(await attempts(tenantId)).toHaveLength(1);
  });
});

describe("maybeTriggerAutoRecharge — hard decline breaker", () => {
  it("records a failed attempt, increments the decline count, and suspends", async () => {
    const tenantId = await makeTenant({ threshold: 0, amount: 250 });
    charge.mockResolvedValueOnce({
      authorized: false,
      credits: 0,
      amountCents: 0,
      declineReason: "card_declined",
      hardDecline: true,
    });

    await maybeTriggerAutoRecharge(tenantId);

    const t = await readTenant(tenantId);
    expect(t.backupCredits).toBe(0);
    expect(t.declineCount).toBe(1);
    expect(t.suspendedAt).not.toBeNull();
    expect(t.lastFailureReason).toBe("card_declined");

    const rows = await attempts(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(await billingEvents(tenantId, "auto_recharge_failed")).toBe(1);
  });
});

describe("soft error → claimed for reconcile; reconcile re-issues the SAME key", () => {
  it("leaves the attempt claimed on a thrown charge, then finalizes on reconcile with the same idempotency key", async () => {
    const tenantId = await makeTenant({ threshold: 0, amount: 250, backup: 0 });

    // 1. Charge throws (network/unknown) → attempt stays 'claimed', no finalize.
    charge.mockRejectedValueOnce(new Error("network blip"));
    await maybeTriggerAutoRecharge(tenantId);

    let rows = await attempts(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("claimed");
    const claimedKey = rows[0].idempotencyKey;

    const afterThrow = await readTenant(tenantId);
    expect(afterThrow.declineCount).toBe(0); // soft error never advances the breaker
    expect(afterThrow.backupCredits).toBe(0);

    // 2. Backdate the claim so the reconciler treats it as stale.
    await pool.query(
      `UPDATE credit_auto_recharge_attempts
          SET updated_at = NOW() - INTERVAL '5 minutes',
              created_at = NOW() - INTERVAL '5 minutes'
        WHERE id = $1`,
      [rows[0].id],
    );

    // 3. Reconcile: the re-issue succeeds. Assert the SAME idempotency key is used.
    charge.mockReset();
    charge.mockResolvedValue({
      authorized: true,
      paymentIntentId: "pi_reconciled_1",
      credits: 250,
      amountCents: 1000,
      hardDecline: false,
    });

    await reconcileAutoRecharge();

    const reissue = charge.mock.calls.find((c) => c[0].idempotencyKey === claimedKey);
    expect(reissue).toBeTruthy();

    rows = await attempts(tenantId);
    const finalized = rows.find((r) => r.idempotencyKey === claimedKey)!;
    expect(finalized.status).toBe("succeeded");
    expect(finalized.paymentIntentId).toBe("pi_reconciled_1");

    const t = await readTenant(tenantId);
    expect(t.backupCredits).toBe(250); // granted exactly once
  });
});

describe("updateAutoRechargeSettings — validation & gating", () => {
  it("refuses to enable without a saved card", async () => {
    const tenantId = await makeTenant({ enabled: false, pmId: null });
    await expect(
      updateAutoRechargeSettings(tenantId, {
        enabled: true,
        thresholdCredits: 100,
        amountCredits: 250,
      }),
    ).rejects.toBeInstanceOf(AutoRechargeValidationError);
  });

  it("rejects an amount that is not a multiple of the block size", async () => {
    const tenantId = await makeTenant({ enabled: false, pmId: "pm_x" });
    await expect(
      updateAutoRechargeSettings(tenantId, {
        enabled: false,
        thresholdCredits: 100,
        amountCredits: 300,
      }),
    ).rejects.toBeInstanceOf(AutoRechargeValidationError);
  });

  it("enabling clears a prior suspension / decline backoff", async () => {
    const tenantId = await makeTenant({
      enabled: false,
      pmId: "pm_x",
      suspendedAt: new Date(),
      declineCount: 3,
    });

    const settings = await updateAutoRechargeSettings(tenantId, {
      enabled: true,
      thresholdCredits: 500,
      amountCredits: 500,
    });

    expect(settings.enabled).toBe(true);
    expect(settings.thresholdCredits).toBe(500);
    expect(settings.amountCredits).toBe(500);
    expect(settings.suspendedAt).toBeNull();
    expect(settings.declineCount).toBe(0);

    const live = await getAutoRechargeSettings(tenantId);
    expect(live.suspendedAt).toBeNull();
    expect(live.declineCount).toBe(0);
  });
});
