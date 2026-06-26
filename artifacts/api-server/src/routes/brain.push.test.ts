import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  absorbedFactsTable,
  classroomVersionsTable,
  classroomFactsTable,
  professorSessionsTable,
} from "@workspace/db";

// The Classroom push runs the Librarian (Grok) adjudication before snapshotting.
// That is an external LLM seam; stub it to a deterministic pass-through so these
// tests assert the snapshot/union + promotion-gate behavior, not LLM output.
// `conflictStatements` lets a test force the adjudicator to flag specific
// statements as contradictions; empty (the default) keeps the pass-through.
const librarianControl = vi.hoisted(() => ({
  conflictStatements: new Set<string>(),
}));
vi.mock("../lib/librarian", async (importActual) => {
  const actual = await importActual<typeof import("../lib/librarian")>();
  return {
    ...actual,
    adjudicateForPush: async (
      facts: Array<{
        id: number;
        statement: string;
        category: string;
        sourceLabel: string;
        tokenCount: number;
      }>,
    ) => {
      const publish: typeof facts = [];
      const conflicts: Array<{ id: number; reason: string }> = [];
      for (const f of facts) {
        if (librarianControl.conflictStatements.has(f.statement)) {
          conflicts.push({ id: f.id, reason: "stubbed contradiction" });
        } else {
          publish.push({ ...f });
        }
      }
      return {
        publish,
        conflicts,
        mergedCount: 0,
        conflictCount: conflicts.length,
      };
    },
  };
});

const { default: app } = await import("../app");

const RUN = `braintest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let tenantId = 0;

// Conductor routes use HTTP Basic when CONDUCTOR_PASSWORD is set; when it is
// unset the middleware runs open. Authenticate either way so the suite is robust
// to the test environment.
function asConductor(req: request.Test): request.Test {
  const pw = process.env["CONDUCTOR_PASSWORD"];
  return pw ? req.auth("conductor", pw) : req;
}

async function seedFact(opts: {
  source: "professor" | "brain";
  status: string;
  statement: string;
  sessionId?: number | null;
  conflictReason?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(absorbedFactsTable)
    .values({
      tenantId,
      sessionId: opts.sessionId ?? null,
      sourceLabel: `${opts.source} source`,
      statement: opts.statement,
      status: opts.status,
      category: "general",
      source: opts.source,
      conflictReason: opts.conflictReason ?? null,
      tokenCount: 5,
    })
    .returning({ id: absorbedFactsTable.id });
  return row.id;
}

async function latestPublishedFacts(): Promise<string[]> {
  const [version] = await db
    .select({ id: classroomVersionsTable.id })
    .from(classroomVersionsTable)
    .where(
      and(
        eq(classroomVersionsTable.tenantId, tenantId),
        eq(classroomVersionsTable.status, "published"),
      ),
    )
    .orderBy(desc(classroomVersionsTable.version))
    .limit(1);
  if (!version) return [];
  const facts = await db
    .select({ statement: classroomFactsTable.statement })
    .from(classroomFactsTable)
    .where(eq(classroomFactsTable.versionId, version.id));
  return facts.map((f) => f.statement);
}

async function versionCount(): Promise<number> {
  const rows = await db
    .select({ id: classroomVersionsTable.id })
    .from(classroomVersionsTable)
    .where(eq(classroomVersionsTable.tenantId, tenantId));
  return rows.length;
}

beforeAll(async () => {
  const [row] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: `Brain push ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: `+1983${String(Date.now()).slice(-7)}`,
    })
    .returning({ id: tenantsTable.id });
  tenantId = row.id;
});

afterEach(async () => {
  // Reset the forced-conflict set so it can't leak across cases.
  librarianControl.conflictStatements.clear();
  // Reset the knowledge state between cases so version counts are deterministic.
  await db
    .delete(classroomFactsTable)
    .where(eq(classroomFactsTable.tenantId, tenantId));
  await db
    .delete(classroomVersionsTable)
    .where(eq(classroomVersionsTable.tenantId, tenantId));
  await db
    .delete(absorbedFactsTable)
    .where(eq(absorbedFactsTable.tenantId, tenantId));
  await db
    .delete(professorSessionsTable)
    .where(eq(professorSessionsTable.tenantId, tenantId));
});

afterAll(async () => {
  if (!tenantId) return;
  await db
    .delete(classroomFactsTable)
    .where(eq(classroomFactsTable.tenantId, tenantId));
  await db
    .delete(classroomVersionsTable)
    .where(eq(classroomVersionsTable.tenantId, tenantId));
  await db
    .delete(absorbedFactsTable)
    .where(eq(absorbedFactsTable.tenantId, tenantId));
  await db
    .delete(professorSessionsTable)
    .where(eq(professorSessionsTable.tenantId, tenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("Brain push — shared-pool snapshot invariant", () => {
  it("Brain push snapshots the UNION so existing Professor facts survive", async () => {
    await seedFact({
      source: "professor",
      status: "published",
      statement: "Professor fact must survive a Brain push",
    });
    const brainId = await seedFact({
      source: "brain",
      status: "draft",
      statement: "Brain candidate approved by a human",
    });

    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/brain/push`),
    ).send({ factIds: [brainId] });

    expect(res.status).toBe(201);
    const statements = await latestPublishedFacts();
    expect(statements).toContain("Professor fact must survive a Brain push");
    expect(statements).toContain("Brain candidate approved by a human");
  });

  it("Brain push clears the flag on an approved flagged (conflict) candidate", async () => {
    const brainId = await seedFact({
      source: "brain",
      status: "conflict",
      statement: "Flagged candidate the human re-approved",
      conflictReason: "flagged: possible duplicate",
    });

    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/brain/push`),
    ).send({ factIds: [brainId] });

    expect(res.status).toBe(201);
    const [row] = await db
      .select({
        status: absorbedFactsTable.status,
        conflictReason: absorbedFactsTable.conflictReason,
      })
      .from(absorbedFactsTable)
      .where(eq(absorbedFactsTable.id, brainId));
    expect(row.status).toBe("published");
    expect(row.conflictReason).toBeNull();
  });

  it("Brain push rejects an unknown id with 400 even when other facts are published, and creates no version", async () => {
    await seedFact({
      source: "professor",
      status: "published",
      statement: "Pre-existing published professor fact",
    });

    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/brain/push`),
    ).send({ factIds: [999999999] });

    expect(res.status).toBe(400);
    expect(await versionCount()).toBe(0);
  });

  it("Brain push refuses to promote a Professor-source id (cross-source guard)", async () => {
    const professorDraftId = await seedFact({
      source: "professor",
      status: "draft",
      statement: "Professor draft that Brain push must not promote",
    });

    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/brain/push`),
    ).send({ factIds: [professorDraftId] });

    expect(res.status).toBe(400);
    const [row] = await db
      .select({ status: absorbedFactsTable.status })
      .from(absorbedFactsTable)
      .where(eq(absorbedFactsTable.id, professorDraftId));
    expect(row.status).toBe("draft");
    expect(await versionCount()).toBe(0);
  });
});

describe("Self-learned (auto_published) facts in a human re-snapshot", () => {
  it("demotes an auto_published fact to conflict when the Librarian flags it on a push", async () => {
    // A clean published fact so the push has something safe to publish
    // (exercises the main snapshot branch, not the all_conflict branch).
    await seedFact({
      source: "professor",
      status: "published",
      statement: "Clean published fact that should survive",
    });
    // A self-learned provisional fact the Librarian will adjudicate as a
    // contradiction during this human push.
    const autoId = await seedFact({
      source: "professor",
      status: "auto_published",
      statement: "Self-learned provisional fact that contradicts",
    });
    librarianControl.conflictStatements.add(
      "Self-learned provisional fact that contradicts",
    );

    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/classroom/push`),
    ).send({});

    expect(res.status).toBe(201);

    // The auto_published row must be demoted to conflict (with a reason) — not
    // left as auto_published, where it would stay groundable and silently
    // re-enter future push unions.
    const [row] = await db
      .select({
        status: absorbedFactsTable.status,
        conflictReason: absorbedFactsTable.conflictReason,
      })
      .from(absorbedFactsTable)
      .where(eq(absorbedFactsTable.id, autoId));
    expect(row.status).toBe("conflict");
    expect(row.conflictReason).toBeTruthy();

    // ...and it must not appear in the new published Classroom version.
    const statements = await latestPublishedFacts();
    expect(statements).toContain("Clean published fact that should survive");
    expect(statements).not.toContain(
      "Self-learned provisional fact that contradicts",
    );
  });
});

describe("Professor classroom push — always a full union (never drops Brain)", () => {
  it("session-scoped Professor push still snapshots Brain facts", async () => {
    const [session] = await db
      .insert(professorSessionsTable)
      .values({ tenantId, title: "S1", model: "test-model" })
      .returning({ id: professorSessionsTable.id });

    await seedFact({
      source: "professor",
      status: "published",
      statement: "Professor published fact in session",
      sessionId: session.id,
    });
    await seedFact({
      source: "brain",
      status: "published",
      statement: "Brain published fact from a prior Brain push",
    });

    const res = await asConductor(
      request(app).post(`/api/tenants/${tenantId}/classroom/push`),
    ).send({ sessionIds: [session.id] });

    expect(res.status).toBe(201);
    const statements = await latestPublishedFacts();
    expect(statements).toContain("Professor published fact in session");
    expect(statements).toContain("Brain published fact from a prior Brain push");
  });
});
