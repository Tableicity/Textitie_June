import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, tenantsTable, creditLedgerTable, billingEventsTable } from "@workspace/db";

// ===========================================================================
// handleCreditCheckoutCompleted — webhook fulfillment guard (real test DB).
// The ONE external seam is the Stripe client (checkout.sessions.retrieve);
// we mock it here — NEVER the DB — so we can feed crafted sessions and prove
// the money-correctness gates: grant only when paid + kind + EXACT amount,
// fail CLOSED on a missing/mismatched amount, and never double-credit on a
// duplicate/replayed webhook (idempotent on `stripe:cs:<sessionId>`).
// ===========================================================================

const sessions = new Map<string, Record<string, unknown>>();

vi.mock("./stripeClient", () => ({
  getUncachableStripeClient: vi.fn(async () => ({
    checkout: {
      sessions: {
        retrieve: vi.fn(async (id: string) => {
          const s = sessions.get(id);
          if (!s) throw new Error(`mock: no such session ${id}`);
          return s;
        }),
      },
    },
  })),
}));

const { handleCreditCheckoutCompleted, OVERAGE_RATE_CENTS } = await import("./stripeCheckout");

const RUN = `creditco-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const createdTenantIds: number[] = [];
let seq = 0;

async function makeTenant(addon = 0): Promise<number> {
  seq += 1;
  const [t] = await db
    .insert(tenantsTable)
    .values({
      slug: `${RUN}-${seq}`,
      name: `CreditCO ${RUN}-${seq}`,
      region: "us",
      tierCode: "starter",
      planTierCode: "starter",
      phoneNumber: `+1974${String(Date.now()).slice(-4)}${String(seq).padStart(3, "0")}`,
      addonCredits: addon,
      creditBucketsMigratedAt: new Date(),
    })
    .returning({ id: tenantsTable.id });
  createdTenantIds.push(t.id);
  return t.id;
}

async function readAddon(id: number): Promise<number> {
  const [t] = await db.select({ addon: tenantsTable.addonCredits }).from(tenantsTable).where(eq(tenantsTable.id, id));
  return t.addon;
}

async function countBillingEvents(tenantId: number): Promise<number> {
  const rows = await db
    .select({ id: billingEventsTable.id })
    .from(billingEventsTable)
    .where(eq(billingEventsTable.tenantId, tenantId));
  return rows.length;
}

function registerSession(
  id: string,
  tenantId: number,
  credits: number,
  overrides: Partial<Record<string, unknown>> = {},
) {
  sessions.set(id, {
    id,
    mode: "payment",
    payment_status: "paid",
    amount_total: credits * OVERAGE_RATE_CENTS,
    metadata: { kind: "addon_credits", tenantId: String(tenantId), credits: String(credits) },
    ...overrides,
  });
}

beforeEach(() => {
  sessions.clear();
});

afterAll(async () => {
  if (createdTenantIds.length === 0) return;
  await db.delete(creditLedgerTable).where(inArray(creditLedgerTable.tenantId, createdTenantIds));
  await db.delete(billingEventsTable).where(inArray(billingEventsTable.tenantId, createdTenantIds));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, createdTenantIds));
});

describe("handleCreditCheckoutCompleted — happy path", () => {
  it("grants the exact credits and writes one billing event on a paid, amount-matched session", async () => {
    const tenantId = await makeTenant(0);
    registerSession("cs_ok", tenantId, 500);

    await handleCreditCheckoutCompleted("cs_ok");

    expect(await readAddon(tenantId)).toBe(500);
    expect(await countBillingEvents(tenantId)).toBe(1);
  });
});

describe("handleCreditCheckoutCompleted — fail CLOSED on amount", () => {
  it("refuses when amount_total is missing/null (never grants blind)", async () => {
    const tenantId = await makeTenant(0);
    registerSession("cs_noamt", tenantId, 500, { amount_total: null });

    await handleCreditCheckoutCompleted("cs_noamt");

    expect(await readAddon(tenantId)).toBe(0); // no blind grant
    expect(await countBillingEvents(tenantId)).toBe(0);
  });

  it("refuses when amount_total does not match credits × rate (tamper guard)", async () => {
    const tenantId = await makeTenant(0);
    registerSession("cs_mismatch", tenantId, 500, { amount_total: 1 }); // way under-paid

    await handleCreditCheckoutCompleted("cs_mismatch");

    expect(await readAddon(tenantId)).toBe(0);
    expect(await countBillingEvents(tenantId)).toBe(0);
  });
});

describe("handleCreditCheckoutCompleted — non-fulfillable sessions", () => {
  it("skips an unpaid session", async () => {
    const tenantId = await makeTenant(0);
    registerSession("cs_unpaid", tenantId, 500, { payment_status: "unpaid" });

    await handleCreditCheckoutCompleted("cs_unpaid");

    expect(await readAddon(tenantId)).toBe(0);
  });

  it("skips a session that is not an addon_credits checkout", async () => {
    const tenantId = await makeTenant(0);
    registerSession("cs_wrongkind", tenantId, 500, {
      metadata: { tenantId: String(tenantId), credits: "500" }, // no kind
    });

    await handleCreditCheckoutCompleted("cs_wrongkind");

    expect(await readAddon(tenantId)).toBe(0);
  });
});

describe("handleCreditCheckoutCompleted — duplicate webhook idempotency", () => {
  it("credits exactly once when the same session webhook is delivered twice", async () => {
    const tenantId = await makeTenant(0);
    registerSession("cs_dup", tenantId, 250);

    await handleCreditCheckoutCompleted("cs_dup");
    await handleCreditCheckoutCompleted("cs_dup"); // replay

    expect(await readAddon(tenantId)).toBe(250); // once, not 500
    expect(await countBillingEvents(tenantId)).toBe(1); // billing event only on the real grant
  });
});
