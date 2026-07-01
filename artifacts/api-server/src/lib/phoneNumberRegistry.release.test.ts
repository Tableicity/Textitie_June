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
  releaseAllTenantNumbers,
} from "./phoneNumberRegistry";

// Exercises releaseAllTenantNumbers against the real test DB (no external
// seams) — the archive/return-to-pool safeguard must delete every canonical row
// and clear the denormalized columns in lockstep, and touch only the target
// tenant.

const RUN = `regrel-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const suffix = String(Date.now()).slice(-7);
const PRIMARY = `+1993${suffix}`;
const DEPTNUM = `+1994${suffix}`;
const B_PRIMARY = `+1995${suffix}`;

let tenantA = 0;
let tenantB = 0;
let deptA = 0;

beforeAll(async () => {
  await ensurePhoneNumbersSchema();
  const [a] = await db
    .insert(tenantsTable)
    .values({ slug: `${RUN}-a`, name: "Rel A", region: "us", tierCode: "starter" })
    .returning({ id: tenantsTable.id });
  const [b] = await db
    .insert(tenantsTable)
    .values({ slug: `${RUN}-b`, name: "Rel B", region: "us", tierCode: "starter" })
    .returning({ id: tenantsTable.id });
  tenantA = a.id;
  tenantB = b.id;
  const [d1] = await db
    .insert(departmentsTable)
    .values({ tenantId: tenantA, name: "Support" })
    .returning({ id: departmentsTable.id });
  deptA = d1.id;
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

describe("releaseAllTenantNumbers", () => {
  it("returns [] and is a no-op when the tenant owns no numbers", async () => {
    expect(await releaseAllTenantNumbers(tenantA)).toEqual([]);
  });

  it("deletes every canonical row, clears the denorm columns, and returns the freed numbers", async () => {
    await setTenantPrimaryNumber(tenantA, PRIMARY);
    await setDepartmentNumber(tenantA, deptA, DEPTNUM, "PNdept");

    const freed = await releaseAllTenantNumbers(tenantA);
    expect(freed.slice().sort()).toEqual([DEPTNUM, PRIMARY].slice().sort());

    // No canonical rows remain for the tenant.
    const rows = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.tenantId, tenantA));
    expect(rows).toHaveLength(0);

    // Tenant primary denorm cleared.
    const [t] = await db
      .select({ phoneNumber: tenantsTable.phoneNumber })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantA));
    expect(t.phoneNumber).toBeNull();

    // Department denorm number + sid cleared.
    const [d] = await db
      .select({
        phoneNumber: departmentsTable.phoneNumber,
        twilioSid: departmentsTable.twilioSid,
      })
      .from(departmentsTable)
      .where(eq(departmentsTable.id, deptA));
    expect(d.phoneNumber).toBeNull();
    expect(d.twilioSid).toBeNull();
  });

  it("releases ONLY the target tenant's numbers", async () => {
    await setTenantPrimaryNumber(tenantA, PRIMARY);
    await setTenantPrimaryNumber(tenantB, B_PRIMARY);

    const freed = await releaseAllTenantNumbers(tenantA);
    expect(freed).toEqual([PRIMARY]);

    // Tenant B is untouched.
    const bRows = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.tenantId, tenantB));
    expect(bRows).toHaveLength(1);
    expect(bRows[0].phoneNumber).toBe(B_PRIMARY);
  });
});
