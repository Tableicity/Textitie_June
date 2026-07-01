import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  usageRecordsTable,
  creditLedgerTable,
} from "@workspace/db";
import {
  chargeMessageCredits,
  refundMessageCredits,
  assessOutboundCredit,
} from "./creditService";

// ===========================================================================
// DB-backed money-correctness suite (real test DB, NO @workspace/db mock).
// The waterfall drain, idempotency guard, debt accrual, backup auto-replenish
// caps, and refund reversal are all SQL behaviors inside one locked txn, so
// they are asserted against the real database. The only external seam
// (backupTopupProvider) is exercised through its real stub here; a DECLINE is
// covered in creditService.decline.test.ts where that seam is mocked.
// ===========================================================================

const RUN = `credsvc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const createdTenantIds: number[] = [];
let seq = 0;

interface MakeTenantOpts {
  addon?: number;
  backup?: number;
  debt?: number;
  backupEnabled?: boolean;
  cap?: number;
  enterprise?: boolean;
  prepaid?: number;
  migrated?: boolean;
  autoRechargeEnabled?: boolean;
  autoRechargeAmount?: number;
  autoRechargePm?: string | null;
  usage?: {
    creditsIncluded: number;
    includedCreditsUsed?: number;
    backupTopupsCount?: number;
  } | null;
}

async function makeTenant(opts: MakeTenantOpts = {}): Promise<number> {
  seq += 1;
  const migrated = opts.migrated ?? true;
  const [t] = await db
    .insert(tenantsTable)
    .values({
      slug: `${RUN}-${seq}`,
      name: `Cred ${RUN}-${seq}`,
      region: "us",
      tierCode: opts.enterprise ? "enterprise" : "starter",
      planTierCode: opts.enterprise ? "enterprise" : "starter",
      phoneNumber: `+1976${String(Date.now()).slice(-4)}${String(seq).padStart(3, "0")}`,
      addonCredits: opts.addon ?? 0,
      backupCredits: opts.backup ?? 0,
      creditDebt: opts.debt ?? 0,
      backupEnabled: opts.backupEnabled ?? false,
      backupTopupCapPerCycle: opts.cap ?? 4,
      prepaidCredits: opts.prepaid ?? 0,
      creditBucketsMigratedAt: migrated ? new Date() : null,
      autoRechargeEnabled: opts.autoRechargeEnabled ?? false,
      autoRechargeAmountCredits: opts.autoRechargeAmount ?? 250,
      autoRechargePaymentMethodId: opts.autoRechargePm ?? null,
    })
    .returning({ id: tenantsTable.id });
  createdTenantIds.push(t.id);

  if (opts.usage) {
    const now = Date.now();
    await db.insert(usageRecordsTable).values({
      tenantId: t.id,
      periodStart: new Date(now - 24 * 60 * 60 * 1000),
      periodEnd: new Date(now + 29 * 24 * 60 * 60 * 1000),
      creditsIncluded: opts.usage.creditsIncluded,
      includedCreditsUsed: opts.usage.includedCreditsUsed ?? 0,
      backupTopupsCount: opts.usage.backupTopupsCount ?? 0,
    });
  }

  return t.id;
}

async function readTenant(id: number) {
  const [t] = await db
    .select({
      addon: tenantsTable.addonCredits,
      backup: tenantsTable.backupCredits,
      debt: tenantsTable.creditDebt,
      prepaid: tenantsTable.prepaidCredits,
      migratedAt: tenantsTable.creditBucketsMigratedAt,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, id));
  return t;
}

async function readUsage(tenantId: number) {
  const [u] = await db
    .select({
      creditsIncluded: usageRecordsTable.creditsIncluded,
      includedCreditsUsed: usageRecordsTable.includedCreditsUsed,
      creditsUsed: usageRecordsTable.creditsUsed,
      messagesSent: usageRecordsTable.messagesSent,
      backupTopupsCount: usageRecordsTable.backupTopupsCount,
      backupTopupCredits: usageRecordsTable.backupTopupCredits,
      backupTopupAmountCents: usageRecordsTable.backupTopupAmountCents,
    })
    .from(usageRecordsTable)
    .where(eq(usageRecordsTable.tenantId, tenantId));
  return u;
}

afterAll(async () => {
  if (createdTenantIds.length === 0) return;
  await db
    .delete(creditLedgerTable)
    .where(inArray(creditLedgerTable.tenantId, createdTenantIds));
  await db
    .delete(usageRecordsTable)
    .where(inArray(usageRecordsTable.tenantId, createdTenantIds));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, createdTenantIds));
});

describe("chargeMessageCredits — waterfall drain order", () => {
  it("drains Included → Add-On → Backup in strict order", async () => {
    // Included remaining = 1, Add-On = 1, Backup = 5, backup off (no top-up).
    const tenantId = await makeTenant({
      addon: 1,
      backup: 5,
      backupEnabled: false,
      usage: { creditsIncluded: 5, includedCreditsUsed: 4 },
    });

    // A 3-credit MMS spans all three buckets: 1 included + 1 add-on + 1 backup.
    const r = await chargeMessageCredits({
      tenantId,
      direction: "outbound",
      body: "x",
      forceMms: true,
      idempotencyKey: "outbound:wf-1",
      reason: "outbound_charge",
      messageId: 1001,
    });

    expect(r.charged).toBe(true);
    expect(r.credits).toBe(3);
    expect(r.channel).toBe("mms");
    expect(r.includedDelta).toBe(-1);
    expect(r.addonDelta).toBe(-1);
    expect(r.backupDelta).toBe(-1);
    expect(r.debtDelta).toBe(0);
    expect(r.balanceAfter).toMatchObject({
      includedRemaining: 0,
      addon: 0,
      backup: 4,
      debt: 0,
    });

    const t = await readTenant(tenantId);
    expect(t).toMatchObject({ addon: 0, backup: 4, debt: 0 });
    const u = await readUsage(tenantId);
    expect(u).toMatchObject({
      includedCreditsUsed: 5,
      creditsUsed: 3,
      messagesSent: 1,
    });
  });
});

describe("chargeMessageCredits — idempotency", () => {
  it("a repeated key is a no-op replay (charges exactly once)", async () => {
    const tenantId = await makeTenant({ addon: 10, backupEnabled: false });

    const first = await chargeMessageCredits({
      tenantId,
      direction: "outbound",
      body: "hi",
      idempotencyKey: "outbound:idem-1",
      reason: "outbound_charge",
      messageId: 2001,
    });
    const second = await chargeMessageCredits({
      tenantId,
      direction: "outbound",
      body: "hi",
      idempotencyKey: "outbound:idem-1",
      reason: "outbound_charge",
      messageId: 2001,
    });

    expect(first.charged).toBe(true);
    expect(first.credits).toBe(1);
    expect(second.charged).toBe(false);
    expect(second.duplicate).toBe(true);

    const t = await readTenant(tenantId);
    expect(t.addon).toBe(9); // drained once, not twice
  });

  it("concurrent charges on the same key never double-charge", async () => {
    const tenantId = await makeTenant({ addon: 10, backupEnabled: false });

    const [a, b] = await Promise.all([
      chargeMessageCredits({
        tenantId,
        direction: "outbound",
        body: "hi",
        idempotencyKey: "outbound:race-1",
        reason: "outbound_charge",
        messageId: 2101,
      }),
      chargeMessageCredits({
        tenantId,
        direction: "outbound",
        body: "hi",
        idempotencyKey: "outbound:race-1",
        reason: "outbound_charge",
        messageId: 2101,
      }),
    ]);

    const chargedCount = [a, b].filter((r) => r.charged).length;
    const dupCount = [a, b].filter((r) => r.duplicate).length;
    expect(chargedCount).toBe(1);
    expect(dupCount).toBe(1);

    const t = await readTenant(tenantId);
    expect(t.addon).toBe(9); // exactly one credit drained
  });
});

describe("chargeMessageCredits — inbound can never be blocked", () => {
  it("accrues debt when buckets are empty and backup is off", async () => {
    const tenantId = await makeTenant({ addon: 0, backup: 0, backupEnabled: false });

    const r = await chargeMessageCredits({
      tenantId,
      direction: "inbound",
      body: "x",
      forceMms: true, // inbound MMS = flat 3
      idempotencyKey: "inbound:dbt-1",
      reason: "inbound_charge",
      messageId: 3001,
    });

    expect(r.charged).toBe(true);
    expect(r.credits).toBe(3);
    expect(r.debtDelta).toBe(3);
    expect(r.balanceAfter.debt).toBe(3);

    const t = await readTenant(tenantId);
    expect(t.debt).toBe(3);
  });

  it("inbound does NOT auto-replenish backup even when enabled", async () => {
    const tenantId = await makeTenant({
      addon: 0,
      backup: 0,
      backupEnabled: true,
      cap: 4,
      usage: { creditsIncluded: 0 },
    });

    const r = await chargeMessageCredits({
      tenantId,
      direction: "inbound",
      body: "hi",
      idempotencyKey: "inbound:noreplenish-1",
      reason: "inbound_charge",
      messageId: 3101,
    });

    // 1-credit SMS → straight to debt; no backup block purchased.
    expect(r.debtDelta).toBe(1);
    expect(r.backupDelta).toBe(0);
    const u = await readUsage(tenantId);
    expect(u.backupTopupsCount).toBe(0);
  });
});

describe("chargeMessageCredits — outbound backup auto-replenish", () => {
  it("does NOT buy a block inline (inline replenish disabled); shortfall goes to debt", async () => {
    const tenantId = await makeTenant({
      addon: 0,
      backup: 0,
      backupEnabled: true,
      cap: 4,
      usage: { creditsIncluded: 0, backupTopupsCount: 0 },
    });

    const r = await chargeMessageCredits({
      tenantId,
      direction: "outbound",
      body: "x",
      forceMms: true, // 3 credits
      idempotencyKey: "outbound:topup-1",
      reason: "outbound_charge",
      messageId: 4001,
    });

    // Inline auto-replenish is neutralized — top-ups now happen OFF the send
    // path via auto-recharge. With no coverage the shortfall falls to debt.
    expect(r.charged).toBe(true);
    expect(r.backupDelta).toBe(0);
    expect(r.debtDelta).toBe(3);
    expect(r.balanceAfter.backup).toBe(0);

    const u = await readUsage(tenantId);
    expect(u.backupTopupsCount).toBe(0); // no inline block purchased
    expect(u.backupTopupCredits).toBe(0);
    expect(u.backupTopupAmountCents).toBe(0);
  });

  it("freezes to debt once the per-cycle top-up cap is exhausted", async () => {
    const tenantId = await makeTenant({
      addon: 0,
      backup: 0,
      backupEnabled: true,
      cap: 2,
      usage: { creditsIncluded: 0, backupTopupsCount: 2 }, // cap already hit
    });

    const r = await chargeMessageCredits({
      tenantId,
      direction: "outbound",
      body: "x",
      forceMms: true, // 3 credits
      idempotencyKey: "outbound:capped-1",
      reason: "outbound_charge",
      messageId: 4101,
    });

    expect(r.backupDelta).toBe(0); // no block purchased
    expect(r.debtDelta).toBe(3); // falls through to debt (post-send)
    const u = await readUsage(tenantId);
    expect(u.backupTopupsCount).toBe(2); // unchanged
  });
});

describe("chargeMessageCredits — enterprise unlimited", () => {
  it("records the message free without moving any bucket", async () => {
    const tenantId = await makeTenant({
      enterprise: true,
      addon: 5,
      backup: 5,
    });

    const r = await chargeMessageCredits({
      tenantId,
      direction: "outbound",
      body: "x",
      forceMms: true,
      idempotencyKey: "outbound:ent-1",
      reason: "outbound_charge",
      messageId: 5001,
    });

    expect(r.unlimited).toBe(true);
    expect(r.charged).toBe(false);
    const t = await readTenant(tenantId);
    expect(t).toMatchObject({ addon: 5, backup: 5, debt: 0 });
  });
});

describe("chargeMessageCredits — lazy prepaid→addon migration", () => {
  it("folds legacy prepaidCredits into Add-On on first charge, once", async () => {
    const tenantId = await makeTenant({
      addon: 0,
      prepaid: 10,
      migrated: false,
      backupEnabled: false,
    });

    const r = await chargeMessageCredits({
      tenantId,
      direction: "outbound",
      body: "hi", // 1 credit
      idempotencyKey: "outbound:mig-1",
      reason: "outbound_charge",
      messageId: 6001,
    });

    expect(r.charged).toBe(true);
    // prepaid 10 migrated into addon, then 1 drained ⇒ 9 add-on, prepaid zeroed.
    expect(r.balanceAfter.addon).toBe(9);
    const t = await readTenant(tenantId);
    expect(t.addon).toBe(9);
    expect(t.prepaid).toBe(0);
    expect(t.migratedAt).not.toBeNull();
  });
});

describe("refundMessageCredits — rejection reversal", () => {
  it("restores the consumed buckets and is idempotent", async () => {
    const tenantId = await makeTenant({
      addon: 5,
      backup: 0,
      backupEnabled: false,
      usage: { creditsIncluded: 10, includedCreditsUsed: 8 }, // remaining 2
    });

    await chargeMessageCredits({
      tenantId,
      direction: "outbound",
      body: "x",
      forceMms: true, // 3 credits: 2 included + 1 add-on
      idempotencyKey: "outbound:rf-1",
      reason: "outbound_charge",
      messageId: 7001,
    });

    let t = await readTenant(tenantId);
    expect(t.addon).toBe(4); // 5 - 1

    const refund = await refundMessageCredits({ tenantId, messageId: 7001 });
    expect(refund.refunded).toBe(true);
    expect(refund.credits).toBe(3);

    t = await readTenant(tenantId);
    expect(t.addon).toBe(5); // add-on restored
    const u = await readUsage(tenantId);
    expect(u.includedCreditsUsed).toBe(8); // included re-opened
    expect(u.creditsUsed).toBe(0);

    // Replay is a no-op.
    const again = await refundMessageCredits({ tenantId, messageId: 7001 });
    expect(again.duplicate).toBe(true);
    t = await readTenant(tenantId);
    expect(t.addon).toBe(5); // not double-refunded
  });

  it("refund restores consumed backup credits (a prior auto-recharge grant is never clawed back)", async () => {
    // 250 backup already on hand — e.g. from an off-session auto-recharge grant.
    const tenantId = await makeTenant({
      addon: 0,
      backup: 250,
      backupEnabled: true,
      cap: 4,
      usage: { creditsIncluded: 0, backupTopupsCount: 0 },
    });

    await chargeMessageCredits({
      tenantId,
      direction: "outbound",
      body: "x",
      forceMms: true, // 3 credits consumed from backup ⇒ 247
      idempotencyKey: "outbound:rf-topup",
      reason: "outbound_charge",
      messageId: 7101,
    });
    let t = await readTenant(tenantId);
    expect(t.backup).toBe(247);

    const refund = await refundMessageCredits({ tenantId, messageId: 7101 });
    expect(refund.refunded).toBe(true);
    // The 3 consumed credits return to backup; the grant itself is untouched.
    t = await readTenant(tenantId);
    expect(t.backup).toBe(250);
  });
});

describe("refundMessageCredits — fast callback before charge", () => {
  it("writes a pending_refund marker that makes the later charge a no-op", async () => {
    const tenantId = await makeTenant({ addon: 10, backupEnabled: false });

    // Rejection callback lands first — no charge exists yet.
    const pending = await refundMessageCredits({ tenantId, messageId: 8001 });
    expect(pending.pending).toBe(true);

    // The (slow) charge now arrives — it must be skipped, not applied.
    const charge = await chargeMessageCredits({
      tenantId,
      direction: "outbound",
      body: "x",
      forceMms: true,
      idempotencyKey: "outbound:pre-1",
      reason: "outbound_charge",
      messageId: 8001,
    });
    expect(charge.skipped).toBe(true);
    expect(charge.charged).toBe(false);

    const t = await readTenant(tenantId);
    expect(t.addon).toBe(10); // untouched
  });

  it("guards a CAMPAIGN message the same way (callback before the inline charge)", async () => {
    const tenantId = await makeTenant({ addon: 10, backupEnabled: false });

    // A campaign send's status callback races ahead of the inline charge.
    const pending = await refundMessageCredits({ tenantId, campaignMessageId: 5501 });
    expect(pending.pending).toBe(true);

    // The campaign charge arrives afterward — it must be skipped, not applied.
    const charge = await chargeMessageCredits({
      tenantId,
      direction: "outbound",
      body: "x",
      forceMms: true,
      idempotencyKey: "campaign_message:5501",
      reason: "campaign_charge",
      campaignMessageId: 5501,
    });
    expect(charge.skipped).toBe(true);
    expect(charge.charged).toBe(false);

    const t = await readTenant(tenantId);
    expect(t.addon).toBe(10); // untouched
  });
});

describe("assessOutboundCredit — read-only hard-stop preflight", () => {
  it("blocks a metered tenant with no coverage and backup off", async () => {
    const tenantId = await makeTenant({
      addon: 0,
      backup: 0,
      backupEnabled: false,
      usage: { creditsIncluded: 0 },
    });

    const a = await assessOutboundCredit({ tenantId, body: "x", forceMms: true });
    expect(a.metered).toBe(true);
    expect(a.coverage).toBe(0);
    expect(a.allowed).toBe(false);
    expect(a.shortfall).toBe(3);
  });

  it("allows when replenishable backup (auto-recharge) covers the cost", async () => {
    const tenantId = await makeTenant({
      addon: 0,
      backup: 0,
      backupEnabled: true,
      cap: 4,
      autoRechargeEnabled: true,
      autoRechargePm: "pm_test_card",
      autoRechargeAmount: 1000, // 4 blocks per recharge
      usage: { creditsIncluded: 0, backupTopupsCount: 0 },
    });

    const a = await assessOutboundCredit({ tenantId, body: "x", forceMms: true });
    expect(a.replenishableBackup).toBe(1000); // min(cap 4, 4 blocks) × 250
    expect(a.allowed).toBe(true);
  });

  it("treats a tenant with no billing context as unmetered (passes)", async () => {
    const tenantId = await makeTenant({
      addon: 0,
      backup: 0,
      backupEnabled: false,
      migrated: false, // never migrated, no usage, no buckets
    });

    const a = await assessOutboundCredit({ tenantId, body: "hi" });
    expect(a.metered).toBe(false);
    expect(a.allowed).toBe(true);
  });

  it("an unlimited tenant always passes", async () => {
    const tenantId = await makeTenant({ enterprise: true });
    const a = await assessOutboundCredit({ tenantId, body: "x", forceMms: true });
    expect(a.unlimited).toBe(true);
    expect(a.allowed).toBe(true);
  });
});
