import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  usageRecordsTable,
  creditLedgerTable,
} from "@workspace/db";

// The backup auto-replenish provider is the ONE external seam (a future Stripe
// off-session charge). Mock it here — NEVER the DB — to simulate a card DECLINE
// and prove an outbound charge then falls through to debt instead of silently
// minting backup credits. Real-stub (authorized) behavior is covered in
// creditService.test.ts.
vi.mock("./backupTopupProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backupTopupProvider")>();
  return {
    ...actual,
    authorizeBackupTopup: vi.fn(async () => ({
      authorized: false,
      credits: 0,
      amountCents: 0,
      declineReason: "card_declined",
    })),
  };
});

const { chargeMessageCredits } = await import("./creditService");

const RUN = `credsvc-decline-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const createdTenantIds: number[] = [];

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

// SCOPE NOTE: the locked "Backup off/declined ⇒ OUTBOUND hard-stop" rule is
// enforced at PREFLIGHT for the "off" case (assessOutboundCredit excludes
// replenishable Backup when backupEnabled=false). True hard-stop on a *decline*
// requires authorizing the card BEFORE the carrier send (reserve-then-send),
// which lands with the real Stripe backup provider — the provider here is still
// a stub that always authorizes. Until then, a decline detected at charge time
// (the message is already sent) cannot un-send; the only money-correct accounting
// is debt. What this test guards is that a decline NEVER mints credits we did not
// pay for and NEVER consumes the per-cycle cap.
describe("chargeMessageCredits — backup top-up DECLINE", () => {
  it("does not mint backup credits and falls through to debt", async () => {
    const now = Date.now();
    const [t] = await db
      .insert(tenantsTable)
      .values({
        slug: RUN,
        name: `Decline ${RUN}`,
        region: "us",
        tierCode: "starter",
        planTierCode: "starter",
        phoneNumber: `+1976${String(now).slice(-7)}`,
        addonCredits: 0,
        backupCredits: 0,
        creditDebt: 0,
        backupEnabled: true,
        backupTopupCapPerCycle: 4,
        creditBucketsMigratedAt: new Date(),
      })
      .returning({ id: tenantsTable.id });
    createdTenantIds.push(t.id);

    await db.insert(usageRecordsTable).values({
      tenantId: t.id,
      periodStart: new Date(now - 24 * 60 * 60 * 1000),
      periodEnd: new Date(now + 29 * 24 * 60 * 60 * 1000),
      creditsIncluded: 0,
      backupTopupsCount: 0,
    });

    const r = await chargeMessageCredits({
      tenantId: t.id,
      direction: "outbound",
      body: "x",
      forceMms: true, // 3 credits
      idempotencyKey: "outbound:decline-1",
      reason: "outbound_charge",
      messageId: 9001,
    });

    expect(r.backupDelta).toBe(0); // nothing minted
    expect(r.debtDelta).toBe(3); // fell through to debt

    const [tenant] = await db
      .select({ backup: tenantsTable.backupCredits, debt: tenantsTable.creditDebt })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, t.id));
    expect(tenant.backup).toBe(0);
    expect(tenant.debt).toBe(3);

    const [usage] = await db
      .select({ topups: usageRecordsTable.backupTopupsCount })
      .from(usageRecordsTable)
      .where(eq(usageRecordsTable.tenantId, t.id));
    expect(usage.topups).toBe(0); // cap not consumed on a decline
  });
});
