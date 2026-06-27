import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  departmentsTable,
  phoneNumbersTable,
} from "@workspace/db";

// External seams: wiring the Twilio inbound webhook and syncing carrier billing
// to Stripe both reach live third-party APIs (the account creds are present in
// this environment), so stub each to a no-op spy and override ONLY that symbol
// (importActual keeps the rest of each module intact for other routes the app
// mounts). The registry DB write is the real behavior under test — these side
// effects are explicitly best-effort.
const applyInboundWebhookByNumber = vi.fn(
  async (_client: unknown, _phoneNumber: string) => ({
    ok: true as const,
    sid: "PNtest",
  }),
);
vi.mock("../lib/twilioNumberWebhook", async (importActual) => {
  const actual =
    await importActual<typeof import("../lib/twilioNumberWebhook")>();
  return { ...actual, applyInboundWebhookByNumber };
});

const syncCarrierBillingToStripe = vi.fn(async () => {});
vi.mock("../lib/carrierBilling", async (importActual) => {
  const actual = await importActual<typeof import("../lib/carrierBilling")>();
  return { ...actual, syncCarrierBillingToStripe };
});

const { ensurePhoneNumbersSchema, setTenantPrimaryNumber, setDepartmentNumber } =
  await import("../lib/phoneNumberRegistry");
const { default: app } = await import("../app");

const RUN = `routedept-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const suffix = String(Date.now()).slice(-7);
const PRIMARY = `+1990${suffix}`;
const OWNED = `+1991${suffix}`;
const OTHER = `+1992${suffix}`; // owned by tenant B

let tenantId = 0;
let otherTenantId = 0;
let deptId = 0;
let otherDeptId = 0; // belongs to tenant B

function asConductor(req: request.Test): request.Test {
  const pw = process.env["CONDUCTOR_PASSWORD"];
  return pw ? req.auth("conductor", pw) : req;
}

beforeAll(async () => {
  await ensurePhoneNumbersSchema();
  const [a] = await db
    .insert(tenantsTable)
    .values({ slug: `${RUN}-a`, name: "Route A", region: "us", tierCode: "starter" })
    .returning({ id: tenantsTable.id });
  const [b] = await db
    .insert(tenantsTable)
    .values({ slug: `${RUN}-b`, name: "Route B", region: "us", tierCode: "starter" })
    .returning({ id: tenantsTable.id });
  tenantId = a.id;
  otherTenantId = b.id;
  const [d] = await db
    .insert(departmentsTable)
    .values({ tenantId, name: "Support", description: "Front line" })
    .returning({ id: departmentsTable.id });
  const [od] = await db
    .insert(departmentsTable)
    .values({ tenantId: otherTenantId, name: "Billing" })
    .returning({ id: departmentsTable.id });
  deptId = d.id;
  otherDeptId = od.id;
});

afterEach(async () => {
  applyInboundWebhookByNumber.mockClear();
  syncCarrierBillingToStripe.mockClear();
  await db
    .delete(phoneNumbersTable)
    .where(inArray(phoneNumbersTable.tenantId, [tenantId, otherTenantId]));
  await db
    .update(tenantsTable)
    .set({ phoneNumber: null })
    .where(inArray(tenantsTable.id, [tenantId, otherTenantId]));
  await db
    .update(departmentsTable)
    .set({ phoneNumber: null, twilioSid: null })
    .where(inArray(departmentsTable.id, [deptId, otherDeptId]));
});

afterAll(async () => {
  await db
    .delete(phoneNumbersTable)
    .where(inArray(phoneNumbersTable.tenantId, [tenantId, otherTenantId]));
  await db
    .delete(departmentsTable)
    .where(inArray(departmentsTable.id, [deptId, otherDeptId]));
  await db
    .delete(tenantsTable)
    .where(inArray(tenantsTable.id, [tenantId, otherTenantId]));
});

describe("GET /tenants/:id/departments", () => {
  it("lists the tenant's departments for the Conductor", async () => {
    const res = await asConductor(
      request(app).get(`/api/tenants/${tenantId}/departments`),
    );
    expect(res.status).toBe(200);
    const dept = res.body.departments.find(
      (d: { id: number }) => d.id === deptId,
    );
    expect(dept).toBeTruthy();
    expect(dept.name).toBe("Support");
    expect(dept.phoneNumber).toBeNull();
    expect(dept.routingStrategy).toBe("round_robin");
  });
});

describe("POST /tenants/:id/departments/:departmentId/number", () => {
  it("assigns an owned number to a department and fires the best-effort side effects", async () => {
    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/departments/${deptId}/number`),
    ).send({ phoneNumber: OWNED });

    expect(res.status).toBe(200);
    expect(res.body.department.phoneNumber).toBe(OWNED);
    expect(res.body.tenantPhoneNumber).toBeNull();

    const [canon] = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, OWNED));
    expect(canon.kind).toBe("department");
    expect(canon.departmentId).toBe(deptId);

    expect(applyInboundWebhookByNumber).toHaveBeenCalledTimes(1);
    expect(applyInboundWebhookByNumber.mock.calls[0]![1]).toBe(OWNED);
    expect(syncCarrierBillingToStripe).toHaveBeenCalledWith(
      tenantId,
      "conductor_department_number_change",
    );
  });

  it("reclaiming the account primary onto a department clears tenants.phone_number", async () => {
    await setTenantPrimaryNumber(tenantId, PRIMARY);

    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/departments/${deptId}/number`),
    ).send({ phoneNumber: PRIMARY });

    expect(res.status).toBe(200);
    expect(res.body.department.phoneNumber).toBe(PRIMARY);
    expect(res.body.tenantPhoneNumber).toBeNull();

    const [tenant] = await db
      .select({ phoneNumber: tenantsTable.phoneNumber })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId));
    expect(tenant.phoneNumber).toBeNull();

    const rows = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, PRIMARY));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("department");
    expect(rows[0].departmentId).toBe(deptId);
  });

  it("returns 409 when the number belongs to another tenant", async () => {
    await setTenantPrimaryNumber(otherTenantId, OTHER);

    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/departments/${deptId}/number`),
    ).send({ phoneNumber: OTHER });

    expect(res.status).toBe(409);
    // Untouched: still tenant B's primary.
    const [canon] = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, OTHER));
    expect(canon.tenantId).toBe(otherTenantId);
    expect(canon.kind).toBe("primary");
  });

  it("returns 404 when the department belongs to a different tenant", async () => {
    const res = await asConductor(
      request(app).post(
        `/api/tenants/${tenantId}/departments/${otherDeptId}/number`,
      ),
    ).send({ phoneNumber: OWNED });

    expect(res.status).toBe(404);
    expect(applyInboundWebhookByNumber).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed number", async () => {
    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/departments/${deptId}/number`),
    ).send({ phoneNumber: "12345" });

    expect(res.status).toBe(400);
    expect(applyInboundWebhookByNumber).not.toHaveBeenCalled();
  });

  it("unassigns (phoneNumber=null) without wiring a webhook but still reconciles billing", async () => {
    await setDepartmentNumber(tenantId, deptId, OWNED);
    applyInboundWebhookByNumber.mockClear();
    syncCarrierBillingToStripe.mockClear();

    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/departments/${deptId}/number`),
    ).send({ phoneNumber: null });

    expect(res.status).toBe(200);
    expect(res.body.department.phoneNumber).toBeNull();

    const rows = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, OWNED));
    expect(rows).toHaveLength(0);

    // No number to wire on an unassign; billing still reconciles.
    expect(applyInboundWebhookByNumber).not.toHaveBeenCalled();
    expect(syncCarrierBillingToStripe).toHaveBeenCalledTimes(1);
  });
});
