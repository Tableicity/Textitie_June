import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, and } from "drizzle-orm";
import { db, tenantsTable, creditLedgerTable } from "@workspace/db";
import { grantAddonCredits } from "./creditEngine";

// ===========================================================================
// DB-backed idempotency suite for grantAddonCredits (real test DB, NO mock).
// This is the money-correctness guard behind the Stripe add-on credit
// purchase: fulfillment keys on `stripe:cs:<sessionId>`, so a duplicate
// Stripe webhook (checkout.session.completed delivered twice, or a retry)
// MUST grant exactly once. The idempotency is a single (tenant_id,
// idempotency_key, reason) unique-index ON CONFLICT guard inside one locked
// txn, so it is asserted against the real database here.
// ===========================================================================

const RUN = `grantaddon-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const createdTenantIds: number[] = [];
let seq = 0;

async function makeTenant(opts: { addon?: number; prepaid?: number; migrated?: boolean } = {}): Promise<number> {
  seq += 1;
  const migrated = opts.migrated ?? true;
  const [t] = await db
    .insert(tenantsTable)
    .values({
      slug: `${RUN}-${seq}`,
      name: `Grant ${RUN}-${seq}`,
      region: "us",
      tierCode: "starter",
      planTierCode: "starter",
      phoneNumber: `+1975${String(Date.now()).slice(-4)}${String(seq).padStart(3, "0")}`,
      addonCredits: opts.addon ?? 0,
      prepaidCredits: opts.prepaid ?? 0,
      creditBucketsMigratedAt: migrated ? new Date() : null,
    })
    .returning({ id: tenantsTable.id });
  createdTenantIds.push(t.id);
  return t.id;
}

async function readAddon(id: number): Promise<number> {
  const [t] = await db
    .select({ addon: tenantsTable.addonCredits, prepaid: tenantsTable.prepaidCredits })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, id));
  return t.addon;
}

async function countGrantRows(tenantId: number, key: string): Promise<number> {
  const rows = await db
    .select({ id: creditLedgerTable.id })
    .from(creditLedgerTable)
    .where(
      and(
        eq(creditLedgerTable.tenantId, tenantId),
        eq(creditLedgerTable.idempotencyKey, key),
        eq(creditLedgerTable.reason, "grant_addon"),
      ),
    );
  return rows.length;
}

afterAll(async () => {
  if (createdTenantIds.length === 0) return;
  await db.delete(creditLedgerTable).where(inArray(creditLedgerTable.tenantId, createdTenantIds));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, createdTenantIds));
});

describe("grantAddonCredits — happy path", () => {
  it("bumps the add-on balance and writes one applied ledger row", async () => {
    const tenantId = await makeTenant({ addon: 40 });
    const key = "stripe:cs:test_happy";

    const r = await grantAddonCredits(tenantId, 500, key, "stripe_checkout");

    expect(r.granted).toBe(true);
    expect(r.newBalance).toBe(540);
    expect(await readAddon(tenantId)).toBe(540);
    expect(await countGrantRows(tenantId, key)).toBe(1);
  });
});

describe("grantAddonCredits — idempotency (duplicate Stripe webhook)", () => {
  it("a repeated key grants once; the second delivery is a no-op replay", async () => {
    const tenantId = await makeTenant({ addon: 0 });
    const key = "stripe:cs:test_dup";

    const first = await grantAddonCredits(tenantId, 250, key, "stripe_checkout");
    const second = await grantAddonCredits(tenantId, 250, key, "stripe_checkout");

    expect(first.granted).toBe(true);
    expect(first.newBalance).toBe(250);
    expect(second.granted).toBe(false);
    // The replay reports the CURRENT balance, not a doubled one.
    expect(second.newBalance).toBe(250);

    expect(await readAddon(tenantId)).toBe(250); // credited once, not twice
    expect(await countGrantRows(tenantId, key)).toBe(1);
  });

  it("concurrent duplicate deliveries never double-credit", async () => {
    const tenantId = await makeTenant({ addon: 0 });
    const key = "stripe:cs:test_race";

    const [a, b] = await Promise.all([
      grantAddonCredits(tenantId, 1000, key, "stripe_checkout"),
      grantAddonCredits(tenantId, 1000, key, "stripe_checkout"),
    ]);

    const grantedCount = [a, b].filter((r) => r.granted).length;
    expect(grantedCount).toBe(1);
    expect(await readAddon(tenantId)).toBe(1000); // exactly one grant applied
    expect(await countGrantRows(tenantId, key)).toBe(1);
  });

  it("distinct keys on the same tenant each grant (two real purchases)", async () => {
    const tenantId = await makeTenant({ addon: 0 });

    await grantAddonCredits(tenantId, 100, "stripe:cs:buy_1", "stripe_checkout");
    await grantAddonCredits(tenantId, 300, "stripe:cs:buy_2", "stripe_checkout");

    expect(await readAddon(tenantId)).toBe(400);
  });
});

describe("grantAddonCredits — lazy prepaid→addon migration", () => {
  it("folds legacy prepaidCredits into Add-On on the first grant", async () => {
    const tenantId = await makeTenant({ addon: 0, prepaid: 25, migrated: false });

    const r = await grantAddonCredits(tenantId, 100, "stripe:cs:mig", "stripe_checkout");

    // 25 prepaid folded in + 100 granted = 125.
    expect(r.granted).toBe(true);
    expect(r.newBalance).toBe(125);

    const [t] = await db
      .select({ addon: tenantsTable.addonCredits, prepaid: tenantsTable.prepaidCredits })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId));
    expect(t.addon).toBe(125);
    expect(t.prepaid).toBe(0); // prepaid drained into add-on, migrated
  });
});

describe("grantAddonCredits — input guards", () => {
  it("rejects a non-positive or non-integer credit amount", async () => {
    const tenantId = await makeTenant({ addon: 0 });
    await expect(grantAddonCredits(tenantId, 0, "stripe:cs:bad0")).rejects.toThrow();
    await expect(grantAddonCredits(tenantId, -5, "stripe:cs:badneg")).rejects.toThrow();
    await expect(grantAddonCredits(tenantId, 1.5, "stripe:cs:badfrac")).rejects.toThrow();
    expect(await readAddon(tenantId)).toBe(0); // nothing granted
  });

  it("rejects an empty idempotency key", async () => {
    const tenantId = await makeTenant({ addon: 0 });
    await expect(grantAddonCredits(tenantId, 100, "")).rejects.toThrow();
  });
});
