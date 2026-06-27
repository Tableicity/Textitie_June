import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  departmentsTable,
  conversationsTable,
} from "@workspace/db";
// No external seams on these Conductor routes (pure DB reads/writes), so unlike
// the number-assignment suite there are no vi.mock calls and app can be imported
// statically.
import app from "../app";

const RUN = `convdept-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let tenantId = 0;
let otherTenantId = 0;
let deptId = 0;
let otherDeptId = 0; // belongs to tenant B
let convAId = 0; // tenant A, unassigned
let convQuarantinedId = 0; // tenant A, unassigned BUT quarantined
let convBId = 0; // tenant B, unassigned

function asConductor(req: request.Test): request.Test {
  const pw = process.env["CONDUCTOR_PASSWORD"];
  return pw ? req.auth("conductor", pw) : req;
}

beforeAll(async () => {
  const [a] = await db
    .insert(tenantsTable)
    .values({ slug: `${RUN}-a`, name: "Conv A", region: "us", tierCode: "starter" })
    .returning({ id: tenantsTable.id });
  const [b] = await db
    .insert(tenantsTable)
    .values({ slug: `${RUN}-b`, name: "Conv B", region: "us", tierCode: "starter" })
    .returning({ id: tenantsTable.id });
  tenantId = a.id;
  otherTenantId = b.id;

  const [d] = await db
    .insert(departmentsTable)
    .values({ tenantId, name: "Support" })
    .returning({ id: departmentsTable.id });
  const [od] = await db
    .insert(departmentsTable)
    .values({ tenantId: otherTenantId, name: "Billing" })
    .returning({ id: departmentsTable.id });
  deptId = d.id;
  otherDeptId = od.id;

  const [ca] = await db
    .insert(conversationsTable)
    .values({ tenantId, contactPhone: "+12025550001", contactName: "Alice" })
    .returning({ id: conversationsTable.id });
  const [cq] = await db
    .insert(conversationsTable)
    .values({
      tenantId,
      contactPhone: "+12025550002",
      contactName: "Quarantined",
      isQuarantined: true,
    })
    .returning({ id: conversationsTable.id });
  const [cb] = await db
    .insert(conversationsTable)
    .values({ tenantId: otherTenantId, contactPhone: "+12025550003" })
    .returning({ id: conversationsTable.id });
  convAId = ca.id;
  convQuarantinedId = cq.id;
  convBId = cb.id;
});

afterAll(async () => {
  await db
    .delete(conversationsTable)
    .where(inArray(conversationsTable.tenantId, [tenantId, otherTenantId]));
  // Departments created during the dup/create tests share the tenant id, so a
  // tenant-scoped delete sweeps both the seeded and test-created rows.
  await db
    .delete(departmentsTable)
    .where(inArray(departmentsTable.tenantId, [tenantId, otherTenantId]));
  await db
    .delete(tenantsTable)
    .where(inArray(tenantsTable.id, [tenantId, otherTenantId]));
});

describe("POST /tenants/:id/departments (create)", () => {
  it("creates a department with the expected shape and tenant scope", async () => {
    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/departments`),
    ).send({ name: "Customer Service" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Customer Service");
    expect(res.body.tenantId).toBe(tenantId);
    expect(res.body.phoneNumber).toBeNull();
    expect(res.body.routingStrategy).toBe("round_robin");
    expect(typeof res.body.id).toBe("number");

    const [row] = await db
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.id, res.body.id));
    expect(row.tenantId).toBe(tenantId);
    expect(row.name).toBe("Customer Service");
  });

  it("trims the name and rejects an empty/whitespace name with 400", async () => {
    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/departments`),
    ).send({ name: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects a case-insensitive duplicate name with 409", async () => {
    const first = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/departments`),
    ).send({ name: "Returns" });
    expect(first.status).toBe(200);

    const dup = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/departments`),
    ).send({ name: "  returns  " });
    expect(dup.status).toBe(409);
  });

  it("returns 404 for a non-existent tenant", async () => {
    const res = await asConductor(
      request(app).post(`/api/tenants/99999999/departments`),
    ).send({ name: "Ghost" });
    expect(res.status).toBe(404);
  });
});

describe("GET /tenants/:id/conversations/unassigned", () => {
  it("lists only unassigned, non-quarantined conversations for the tenant", async () => {
    const res = await asConductor(
      request(app).get(`/api/tenants/${tenantId}/conversations/unassigned`),
    );
    expect(res.status).toBe(200);
    const ids = res.body.conversations.map((c: { id: number }) => c.id);
    expect(ids).toContain(convAId);
    // Quarantined and cross-tenant conversations never surface here.
    expect(ids).not.toContain(convQuarantinedId);
    expect(ids).not.toContain(convBId);

    const alice = res.body.conversations.find(
      (c: { id: number }) => c.id === convAId,
    );
    expect(alice.contactName).toBe("Alice");
    expect(alice.contactPhone).toBe("+12025550001");
    expect(alice.departmentId).toBeNull();
  });

  it("drops a conversation from the list once it has a department", async () => {
    // Move it in, then confirm it disappears from the unassigned list.
    const move = await asConductor(
      request(app).patch(
        `/api/tenants/${tenantId}/conversations/${convAId}`,
      ),
    ).send({ departmentId: deptId });
    expect(move.status).toBe(200);

    const res = await asConductor(
      request(app).get(`/api/tenants/${tenantId}/conversations/unassigned`),
    );
    const ids = res.body.conversations.map((c: { id: number }) => c.id);
    expect(ids).not.toContain(convAId);

    // Restore for any later assertions / isolation.
    await db
      .update(conversationsTable)
      .set({ departmentId: null })
      .where(eq(conversationsTable.id, convAId));
  });
});

describe("PATCH /tenants/:id/conversations/:conversationId (move)", () => {
  it("moves a conversation into a tenant department, changing only department_id", async () => {
    const res = await asConductor(
      request(app).patch(
        `/api/tenants/${tenantId}/conversations/${convAId}`,
      ),
    ).send({ departmentId: deptId });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(convAId);
    expect(res.body.departmentId).toBe(deptId);

    const [row] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convAId));
    expect(row.departmentId).toBe(deptId);
    // Untouched fields.
    expect(row.contactPhone).toBe("+12025550001");
    expect(row.assignedUserId).toBeNull();
  });

  it("unassigns when departmentId is null", async () => {
    const res = await asConductor(
      request(app).patch(
        `/api/tenants/${tenantId}/conversations/${convAId}`,
      ),
    ).send({ departmentId: null });

    expect(res.status).toBe(200);
    expect(res.body.departmentId).toBeNull();

    const [row] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convAId));
    expect(row.departmentId).toBeNull();
  });

  it("returns 404 when the department belongs to another tenant", async () => {
    const res = await asConductor(
      request(app).patch(
        `/api/tenants/${tenantId}/conversations/${convAId}`,
      ),
    ).send({ departmentId: otherDeptId });

    expect(res.status).toBe(404);
    const [row] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convAId));
    expect(row.departmentId).toBeNull();
  });

  it("returns 404 when the conversation is not in the tenant", async () => {
    const res = await asConductor(
      request(app).patch(
        `/api/tenants/${tenantId}/conversations/${convBId}`,
      ),
    ).send({ departmentId: deptId });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a quarantined conversation", async () => {
    const res = await asConductor(
      request(app).patch(
        `/api/tenants/${tenantId}/conversations/${convQuarantinedId}`,
      ),
    ).send({ departmentId: deptId });
    expect(res.status).toBe(404);
  });
});
