import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  tiersTable,
  billingEventsTable,
  usageRecordsTable,
} from "@workspace/db";

// ===========================================================================
// DB-backed integration suite for the self-healing billing reconcile
// ORCHESTRATOR (real test DB, NO @workspace/db mock — per the repo DB-backed
// test pattern). The pure decision helpers already have unit coverage in
// billingReconcile.test.ts; this spec proves the parts that only the
// orchestrator wires together:
//   - the atomic throttle CLAIM (a concurrent burst activates exactly once),
//   - the reuse of activateSubscription (the tenant row actually flips to
//     "active" with the right plan tier + a billing_events row), and
//   - the fail-closed selection (a past_due-only customer stays LOCKED).
//
// The ONLY mocked seam is the Stripe client (getUncachableStripeClient). Its
// subscriptions.list return is driven per-test via the mutable `stripeSubs`.
// ===========================================================================

let stripeSubs: Array<Record<string, unknown>> = [];

vi.mock("./stripeClient", () => ({
  getUncachableStripeClient: async () => ({
    subscriptions: {
      list: async () => ({ data: stripeSubs }),
      // syncCarrierBillingToStripe (best-effort, called at the tail of
      // activateSubscription and try/caught there) may hit these — give it
      // harmless no-ops so activation completes cleanly.
      retrieve: async () => ({ items: { data: [] } }),
    },
    subscriptionItems: {
      del: async () => {},
      create: async () => {},
      update: async () => {},
    },
  }),
}));

// Import AFTER the mock is registered so the module graph binds the stubbed
// Stripe client.
const { reconcileTenantBillingFromStripe, BILLING_RECONCILE_THROTTLE_MS } =
  await import("./billingReconcile");

const RUN = `billrec-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TIER_CODE = `${RUN}-growth`;
const TIER_PRICE = `price_${RUN}`;
const createdTenantIds: number[] = [];
let seq = 0;

const nowSec = Math.floor(Date.now() / 1000);

function activeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: `sub_${RUN}_${seq}`,
    status: "active",
    metadata: { tierCode: TIER_CODE },
    items: {
      data: [
        {
          price: { id: TIER_PRICE },
          current_period_start: nowSec,
          current_period_end: nowSec + 30 * 24 * 3600,
        },
      ],
    },
    current_period_start: nowSec,
    current_period_end: nowSec + 30 * 24 * 3600,
    trial_end: null,
    ...overrides,
  };
}

interface MakeTenantOpts {
  subscriptionStatus?: string;
  stripeCustomerId?: string | null;
  lastBillingSyncAt?: Date | null;
  billingBypass?: boolean;
}

async function makeLockedTenant(opts: MakeTenantOpts = {}): Promise<number> {
  seq += 1;
  const [t] = await db
    .insert(tenantsTable)
    .values({
      slug: `${RUN}-${seq}`,
      name: `BillRec ${RUN}-${seq}`,
      region: "us",
      tierCode: "starter",
      planTierCode: null,
      phoneNumber: `+1974${String(Date.now()).slice(-4)}${String(seq).padStart(3, "0")}`,
      subscriptionStatus: opts.subscriptionStatus ?? "expired",
      stripeCustomerId:
        opts.stripeCustomerId === undefined
          ? `cus_${RUN}_${seq}`
          : opts.stripeCustomerId,
      lastBillingSyncAt: opts.lastBillingSyncAt ?? null,
      billingBypass: opts.billingBypass ?? false,
    })
    .returning({ id: tenantsTable.id });
  createdTenantIds.push(t!.id);
  return t!.id;
}

async function getTenant(id: number) {
  const [row] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, id))
    .limit(1);
  return row!;
}

async function countBillingEvents(id: number): Promise<number> {
  const rows = await db
    .select({ id: billingEventsTable.id })
    .from(billingEventsTable)
    .where(eq(billingEventsTable.tenantId, id));
  return rows.length;
}

beforeEach(async () => {
  // A real, groundable tier so activateSubscription resolves credits and tier
  // metadata deterministically. Insert once; ignore if it already exists.
  await db
    .insert(tiersTable)
    .values({
      code: TIER_CODE,
      name: "BillRec Growth",
      description: "integration test tier",
      monthlyPriceCents: 9900,
      includedCredits: 2500,
      stripePriceId: TIER_PRICE,
    })
    .onConflictDoNothing({ target: tiersTable.code });
  stripeSubs = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  if (createdTenantIds.length) {
    await db
      .delete(billingEventsTable)
      .where(inArray(billingEventsTable.tenantId, createdTenantIds));
    await db
      .delete(usageRecordsTable)
      .where(inArray(usageRecordsTable.tenantId, createdTenantIds));
    await db
      .delete(tenantsTable)
      .where(inArray(tenantsTable.id, createdTenantIds));
  }
  await db.delete(tiersTable).where(eq(tiersTable.code, TIER_CODE));
});

describe("reconcileTenantBillingFromStripe (DB-backed orchestrator)", () => {
  it("self-heals a paid-but-locked tenant: flips to active with the right tier and writes a billing_events row", async () => {
    const tenantId = await makeLockedTenant();
    stripeSubs = [activeSub()];

    const result = await reconcileTenantBillingFromStripe(tenantId);

    expect(result).toEqual({ reconciled: true, status: "active" });

    const tenant = await getTenant(tenantId);
    expect(tenant.subscriptionStatus).toBe("active");
    expect(tenant.planTierCode).toBe(TIER_CODE);
    expect(tenant.stripeSubscriptionId).toBe(`sub_${RUN}_${seq}`);
    // The claim slot was stamped as part of reconciling.
    expect(tenant.lastBillingSyncAt).not.toBeNull();

    expect(await countBillingEvents(tenantId)).toBe(1);
    const [evt] = await db
      .select()
      .from(billingEventsTable)
      .where(eq(billingEventsTable.tenantId, tenantId));
    expect(evt!.eventType).toBe("subscribed");
    expect(evt!.toTier).toBe(TIER_CODE);
  });

  it("throttle claim: a concurrent burst activates exactly once (no duplicate activation)", async () => {
    const tenantId = await makeLockedTenant();
    stripeSubs = [activeSub()];

    // Two reconciles fire at once for the same locked tenant. Activation must
    // happen exactly once: the atomic, conditional claim UPDATE lets only one
    // caller proceed. The loser is skipped — either it lost the claim
    // ("throttled") or it read the row after the winner already committed
    // ("already_active"); both outcomes prove no duplicate activation.
    const results = await Promise.all([
      reconcileTenantBillingFromStripe(tenantId),
      reconcileTenantBillingFromStripe(tenantId),
    ]);

    const reconciled = results.filter((r) => r.reconciled);
    const skipped = results.filter(
      (r) =>
        !r.reconciled &&
        (r.reason === "throttled" || r.reason === "already_active"),
    );
    expect(reconciled).toHaveLength(1);
    expect(skipped).toHaveLength(1);

    // Activation happened exactly once despite two concurrent callers.
    const tenant = await getTenant(tenantId);
    expect(tenant.subscriptionStatus).toBe("active");
    expect(await countBillingEvents(tenantId)).toBe(1);
  });

  it("throttle window: a second immediate reconcile is skipped as throttled", async () => {
    // Locked tenant, but re-checked moments ago (inside the window) and NOT yet
    // active — the throttle gate must short-circuit before any Stripe call.
    const tenantId = await makeLockedTenant({
      lastBillingSyncAt: new Date(Date.now() - 1_000),
    });
    stripeSubs = [activeSub()];

    const result = await reconcileTenantBillingFromStripe(tenantId);
    expect(result).toEqual({ reconciled: false, reason: "throttled" });

    const tenant = await getTenant(tenantId);
    expect(tenant.subscriptionStatus).toBe("expired");
    expect(await countBillingEvents(tenantId)).toBe(0);
  });

  it("past_due-only customer does NOT unlock", async () => {
    const tenantId = await makeLockedTenant();
    stripeSubs = [
      activeSub({ status: "past_due" }),
      activeSub({ id: `sub_${RUN}_${seq}_cx`, status: "canceled" }),
    ];

    const result = await reconcileTenantBillingFromStripe(tenantId);
    expect(result).toEqual({
      reconciled: false,
      reason: "no_active_subscription",
    });

    const tenant = await getTenant(tenantId);
    expect(tenant.subscriptionStatus).toBe("expired");
    expect(tenant.planTierCode).toBeNull();
    expect(await countBillingEvents(tenantId)).toBe(0);
    // The claim slot WAS stamped (we reached Stripe) — proves the tenant stayed
    // locked by the selection, not by the throttle gate.
    expect(tenant.lastBillingSyncAt).not.toBeNull();
  });

  it("respects the throttle window constant boundary (sanity on exported window)", () => {
    expect(BILLING_RECONCILE_THROTTLE_MS).toBeGreaterThan(0);
  });
});
