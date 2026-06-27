import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
  setDepartmentNumber,
  PhoneNumberConflictError,
} from "./phoneNumberRegistry";

// These exercise the real registry against the test DB (no external seams), so
// the primary↔department XOR invariant and the admin reclaim flag are verified
// at the source of truth, not just through the HTTP layer.

const RUN = `regdept-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const suffix = String(Date.now()).slice(-7);
const A_PRIMARY = `+1990${suffix}`;
const SHARED = `+1991${suffix}`; // tenant B owns this; A must never reclaim it
const OTHER_DEPT_NUM = `+1992${suffix}`;

let tenantA = 0;
let tenantB = 0;
let deptA = 0;
let deptA2 = 0;

beforeAll(async () => {
  await ensurePhoneNumbersSchema();
  const [a] = await db
    .insert(tenantsTable)
    .values({ slug: `${RUN}-a`, name: "Reg A", region: "us", tierCode: "starter" })
    .returning({ id: tenantsTable.id });
  const [b] = await db
    .insert(tenantsTable)
    .values({ slug: `${RUN}-b`, name: "Reg B", region: "us", tierCode: "starter" })
    .returning({ id: tenantsTable.id });
  tenantA = a.id;
  tenantB = b.id;
  const [d1] = await db
    .insert(departmentsTable)
    .values({ tenantId: tenantA, name: "Support" })
    .returning({ id: departmentsTable.id });
  const [d2] = await db
    .insert(departmentsTable)
    .values({ tenantId: tenantA, name: "Sales" })
    .returning({ id: departmentsTable.id });
  deptA = d1.id;
  deptA2 = d2.id;
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
    .where(inArray(departmentsTable.id, [deptA, deptA2]));
});

afterAll(async () => {
  await db
    .delete(phoneNumbersTable)
    .where(inArray(phoneNumbersTable.tenantId, [tenantA, tenantB]));
  await db
    .delete(departmentsTable)
    .where(inArray(departmentsTable.id, [deptA, deptA2]));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [tenantA, tenantB]));
});

describe("setDepartmentNumber — own-primary reclaim flag", () => {
  it("WITHOUT the flag, assigning this tenant's own primary to a dept throws and changes nothing", async () => {
    await setTenantPrimaryNumber(tenantA, A_PRIMARY);

    await expect(
      setDepartmentNumber(tenantA, deptA, A_PRIMARY),
    ).rejects.toBeInstanceOf(PhoneNumberConflictError);

    // Primary is intact; the department got nothing.
    const [tenant] = await db
      .select({ phoneNumber: tenantsTable.phoneNumber })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantA));
    expect(tenant.phoneNumber).toBe(A_PRIMARY);
    const [canon] = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, A_PRIMARY));
    expect(canon.kind).toBe("primary");
    expect(canon.departmentId).toBeNull();
  });

  it("WITH the flag, the same assign atomically moves the number off primary onto the dept", async () => {
    await setTenantPrimaryNumber(tenantA, A_PRIMARY);

    const res = await setDepartmentNumber(tenantA, deptA, A_PRIMARY, null, {
      allowReclaimFromOwnPrimary: true,
    });
    expect(res.phoneNumber).toBe(A_PRIMARY);

    // Primary cleared on the tenant row.
    const [tenant] = await db
      .select({ phoneNumber: tenantsTable.phoneNumber })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantA));
    expect(tenant.phoneNumber).toBeNull();

    // Department now denormalizes the number.
    const [dept] = await db
      .select({ phoneNumber: departmentsTable.phoneNumber })
      .from(departmentsTable)
      .where(eq(departmentsTable.id, deptA));
    expect(dept.phoneNumber).toBe(A_PRIMARY);

    // Exactly one canonical row, now a department row (XOR upheld).
    const rows = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, A_PRIMARY));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("department");
    expect(rows[0].departmentId).toBe(deptA);
    expect(rows[0].tenantId).toBe(tenantA);
  });

  it("the flag NEVER reclaims another tenant's number — cross-tenant still throws", async () => {
    await setTenantPrimaryNumber(tenantB, SHARED);

    await expect(
      setDepartmentNumber(tenantA, deptA, SHARED, null, {
        allowReclaimFromOwnPrimary: true,
      }),
    ).rejects.toBeInstanceOf(PhoneNumberConflictError);

    // Tenant B keeps it.
    const [canon] = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, SHARED));
    expect(canon.tenantId).toBe(tenantB);
    expect(canon.kind).toBe("primary");
  });

  it("a number already on another department of the same tenant still throws (even with the flag)", async () => {
    await setDepartmentNumber(tenantA, deptA2, OTHER_DEPT_NUM);

    await expect(
      setDepartmentNumber(tenantA, deptA, OTHER_DEPT_NUM, null, {
        allowReclaimFromOwnPrimary: true,
      }),
    ).rejects.toBeInstanceOf(PhoneNumberConflictError);

    // Still owned by the original department.
    const [canon] = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, OTHER_DEPT_NUM));
    expect(canon.departmentId).toBe(deptA2);
  });

  it("unassigning (null) clears the department's canonical row and denorm column", async () => {
    await setDepartmentNumber(tenantA, deptA, OTHER_DEPT_NUM);

    const res = await setDepartmentNumber(tenantA, deptA, null);
    expect(res.phoneNumber).toBeNull();

    const rows = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, OTHER_DEPT_NUM));
    expect(rows).toHaveLength(0);
    const [dept] = await db
      .select({ phoneNumber: departmentsTable.phoneNumber })
      .from(departmentsTable)
      .where(eq(departmentsTable.id, deptA));
    expect(dept.phoneNumber).toBeNull();
  });
});
