import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, tenantsTable, absorbedFactsTable } from "@workspace/db";

// Route-level coverage for the Conductor-only Auto-Learned review queue: it
// asserts the HTTP wiring (auth + 200/404/409 mapping) the lib unit tests don't.
const { default: app } = await import("../app");

const RUN = `autolearn-route-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let tenantId = 0;

// Conductor routes use HTTP Basic when CONDUCTOR_PASSWORD is set; authenticate
// either way so the suite is robust to the test environment.
function asConductor(req: request.Test): request.Test {
  const pw = process.env["CONDUCTOR_PASSWORD"];
  return pw ? req.auth("conductor", pw) : req;
}

async function seed(status: string, statement: string): Promise<number> {
  const [row] = await db
    .insert(absorbedFactsTable)
    .values({
      tenantId,
      sessionId: null,
      sourceLabel: "Professor (live escalation)",
      statement,
      status,
      category: "general",
      source: "professor",
      tokenCount: 5,
    })
    .returning({ id: absorbedFactsTable.id });
  return row.id;
}

beforeAll(async () => {
  const [row] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: `Auto-learn route ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: `+1986${String(Date.now()).slice(-7)}`,
    })
    .returning({ id: tenantsTable.id });
  tenantId = row.id;
});

afterEach(async () => {
  await db
    .delete(absorbedFactsTable)
    .where(eq(absorbedFactsTable.tenantId, tenantId));
});

afterAll(async () => {
  if (!tenantId) return;
  await db
    .delete(absorbedFactsTable)
    .where(eq(absorbedFactsTable.tenantId, tenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("Auto-Learned review routes (Conductor)", () => {
  it("GET lists self-learned pending facts", async () => {
    await seed("auto_published", "Listed self-learned fact.");
    const res = await asConductor(
      request(app).get(`/api/tenants/${tenantId}/knowledge/auto-learned`),
    );
    expect(res.status).toBe(200);
    const statements = (res.body as Array<{ statement: string }>).map(
      (f) => f.statement,
    );
    expect(statements).toContain("Listed self-learned fact.");
  });

  it("approve returns 200 and publishes an auto_published fact", async () => {
    const id = await seed("auto_published", "Approve me via route.");
    const res = await asConductor(
      request(app).post(
        `/api/tenants/${tenantId}/knowledge/auto-learned/${id}/approve`,
      ),
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
  });

  it("approve returns 404 for an unknown fact", async () => {
    const res = await asConductor(
      request(app).post(
        `/api/tenants/${tenantId}/knowledge/auto-learned/999999999/approve`,
      ),
    );
    expect(res.status).toBe(404);
  });

  it("reject returns 409 for a fact that is not reviewable", async () => {
    const id = await seed("published", "Already published — not reviewable.");
    const res = await asConductor(
      request(app).post(
        `/api/tenants/${tenantId}/knowledge/auto-learned/${id}/reject`,
      ),
    );
    expect(res.status).toBe(409);
  });
});
