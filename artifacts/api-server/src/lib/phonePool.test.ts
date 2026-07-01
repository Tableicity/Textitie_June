import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  departmentsTable,
  phoneNumbersTable,
} from "@workspace/db";
import {
  ensurePhoneNumbersSchema,
  setTenantPrimaryNumber,
} from "./phoneNumberRegistry";

// Mock ONLY the external Twilio seam + the two thin Twilio-only helpers. The
// pool-selection logic and the real DB registry write (setDepartmentNumber) run
// for real against the test DB, so the "grab the next Available number and
// register it to the Demo Department" behavior is verified end-to-end minus the
// network.
const { listMock, updateMock, applyWebhookMock, state } = vi.hoisted(() => ({
  listMock: vi.fn(),
  updateMock: vi.fn(),
  applyWebhookMock: vi.fn(),
  state: { webhookAvailable: true },
}));

vi.mock("twilio", () => ({
  default: () => ({
    incomingPhoneNumbers: Object.assign((_sid: string) => ({ update: updateMock }), {
      list: listMock,
    }),
  }),
}));

vi.mock("./twilioNumberWebhook", () => ({
  applyInboundWebhookBySid: (...args: unknown[]) => applyWebhookMock(...args),
}));

vi.mock("./publicTwilioUrls", () => ({
  getPublicWebhookConfig: () =>
    state.webhookAvailable
      ? { available: true }
      : { available: false, reason: "no_public_base_url" },
}));

import { claimPoolNumberForDepartment } from "./phonePool";

const RUN = `pool-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const suffix = String(Date.now()).slice(-7);
const NUM_A = `+1996${suffix}`; // already assigned to tenantB (taken)
const NUM_B = `+1997${suffix}`; // free in the pool

let tenantA = 0;
let tenantB = 0;
let deptA = 0;

beforeAll(async () => {
  process.env["TWILIO_ACCOUNT_SID"] = "ACtestpool";
  process.env["TWILIO_AUTH_TOKEN"] = "testtoken";
  await ensurePhoneNumbersSchema();
  const [a] = await db
    .insert(tenantsTable)
    .values({ slug: `${RUN}-a`, name: "Pool A", region: "us", tierCode: "starter" })
    .returning({ id: tenantsTable.id });
  const [b] = await db
    .insert(tenantsTable)
    .values({ slug: `${RUN}-b`, name: "Pool B", region: "us", tierCode: "starter" })
    .returning({ id: tenantsTable.id });
  tenantA = a.id;
  tenantB = b.id;
  const [d1] = await db
    .insert(departmentsTable)
    .values({ tenantId: tenantA, name: "Demo Department" })
    .returning({ id: departmentsTable.id });
  deptA = d1.id;
});

beforeEach(() => {
  state.webhookAvailable = true;
  listMock.mockReset();
  updateMock.mockReset().mockResolvedValue({});
  applyWebhookMock.mockReset().mockResolvedValue({ ok: true });
});

afterEach(async () => {
  await db
    .delete(phoneNumbersTable)
    .where(inArray(phoneNumbersTable.tenantId, [tenantA, tenantB]));
  await db
    .update(tenantsTable)
    .set({ phoneNumber: null })
    .where(inArray(tenantsTable.id, [tenantA, tenantB]));
  await db
    .update(departmentsTable)
    .set({ phoneNumber: null, twilioSid: null })
    .where(eq(departmentsTable.id, deptA));
});

afterAll(async () => {
  await db
    .delete(phoneNumbersTable)
    .where(inArray(phoneNumbersTable.tenantId, [tenantA, tenantB]));
  await db.delete(departmentsTable).where(eq(departmentsTable.id, deptA));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [tenantA, tenantB]));
});

describe("claimPoolNumberForDepartment", () => {
  it("skips (no pool consumed) when there is no public webhook — dev/preview", async () => {
    state.webhookAvailable = false;

    const res = await claimPoolNumberForDepartment(tenantA, deptA);
    expect(res.assigned).toBeNull();
    expect(res.reason).toBe("no_public_webhook");
    // Never even hit Twilio.
    expect(listMock).not.toHaveBeenCalled();
  });

  it("grabs the next Available (owned − registered) number and registers it to the department", async () => {
    // NUM_A is already owned by tenantB -> it is NOT in the pool.
    await setTenantPrimaryNumber(tenantB, NUM_A);
    listMock.mockResolvedValue([
      { phoneNumber: NUM_A, sid: "PN_a" },
      { phoneNumber: NUM_B, sid: "PN_b" },
    ]);

    const res = await claimPoolNumberForDepartment(tenantA, deptA);
    expect(res.assigned).toBe(NUM_B);

    // Canonical registry row created as a department number for tenantA.
    const [row] = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, NUM_B));
    expect(row.tenantId).toBe(tenantA);
    expect(row.departmentId).toBe(deptA);
    expect(row.kind).toBe("department");
    expect(row.twilioSid).toBe("PN_b");

    // Department denorm updated.
    const [dept] = await db
      .select({ phoneNumber: departmentsTable.phoneNumber })
      .from(departmentsTable)
      .where(eq(departmentsTable.id, deptA));
    expect(dept.phoneNumber).toBe(NUM_B);

    // Inbound webhook wired for the claimed SID.
    expect(applyWebhookMock).toHaveBeenCalledTimes(1);
    expect(applyWebhookMock.mock.calls[0][1]).toBe("PN_b");
  });

  it("returns pool_empty when every owned number is already assigned", async () => {
    await setTenantPrimaryNumber(tenantB, NUM_A);
    listMock.mockResolvedValue([{ phoneNumber: NUM_A, sid: "PN_a" }]);

    const res = await claimPoolNumberForDepartment(tenantA, deptA);
    expect(res.assigned).toBeNull();
    expect(res.reason).toBe("pool_empty");
    expect(applyWebhookMock).not.toHaveBeenCalled();
  });

  it("still succeeds (number registered) when webhook wiring fails — best-effort", async () => {
    applyWebhookMock.mockResolvedValue({ ok: false, reason: "not_owned" });
    listMock.mockResolvedValue([{ phoneNumber: NUM_B, sid: "PN_b" }]);

    const res = await claimPoolNumberForDepartment(tenantA, deptA);
    expect(res.assigned).toBe(NUM_B);

    const [row] = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, NUM_B));
    expect(row.departmentId).toBe(deptA);
  });

  it("skips an unroutable (malformed) candidate and claims the next valid one", async () => {
    // A non-empty garbage number makes normalizePhoneE164 THROW; the loop must
    // skip it (not abort) and go on to register the valid candidate.
    listMock.mockResolvedValue([
      { phoneNumber: "not-a-number", sid: "PN_bad" },
      { phoneNumber: NUM_B, sid: "PN_b" },
    ]);

    const res = await claimPoolNumberForDepartment(tenantA, deptA);
    expect(res.assigned).toBe(NUM_B);

    const [row] = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, NUM_B));
    expect(row.departmentId).toBe(deptA);
    expect(row.twilioSid).toBe("PN_b");
  });

  it("returns twilio_list_failed (pool untouched) when the owned-numbers call throws", async () => {
    listMock.mockRejectedValue(new Error("twilio 500"));

    const res = await claimPoolNumberForDepartment(tenantA, deptA);
    expect(res.assigned).toBeNull();
    expect(res.reason).toBe("twilio_list_failed");
  });
});
