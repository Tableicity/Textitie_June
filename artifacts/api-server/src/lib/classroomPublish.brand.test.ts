import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  absorbedFactsTable,
  classroomVersionsTable,
  classroomFactsTable,
} from "@workspace/db";

// Force the Librarian (external LLM seam) to emit a brand-new "merged" statement
// that REINTRODUCES a competitor name AFTER the input-side scrub has already run.
// This is the exact hole the final brand-safety pass in publishClassroomSnapshot
// must close: nothing the closed-book Auto-Pilot grounds on may carry "TextLine".
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
    ) => ({
      publish: facts.map((f) => ({
        ...f,
        statement: "TextLine pricing starts at $5/mo.",
        sourceLabel: "[TextLine] merged source",
      })),
      conflicts: [] as Array<{ id: number; reason: string }>,
      mergedCount: 1,
      conflictCount: 0,
    }),
  };
});

const { publishClassroomSnapshot } = await import("./classroomPublish");

const RUN = `brandpub-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let tenantId = 0;
let factId = 0;

beforeAll(async () => {
  const [tenant] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: `Brand pub ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: `+1984${String(Date.now()).slice(-7)}`,
    })
    .returning({ id: tenantsTable.id });
  tenantId = tenant.id;

  const [fact] = await db
    .insert(absorbedFactsTable)
    .values({
      tenantId,
      sessionId: null,
      sourceLabel: "seed source",
      statement: "Our plans are affordable.",
      status: "published",
      category: "pricing",
      source: "brain",
      tokenCount: 5,
    })
    .returning({ id: absorbedFactsTable.id });
  factId = fact.id;
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
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("publishClassroomSnapshot — brand safety", () => {
  it("scrubs competitor names the Librarian reintroduces in its merged output", async () => {
    const [fact] = await db
      .select()
      .from(absorbedFactsTable)
      .where(eq(absorbedFactsTable.id, factId));

    const result = await publishClassroomSnapshot({
      tenantId,
      factsToPublish: [fact],
      markSessions: { mode: "none" },
    });
    expect(result.ok).toBe(true);

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
    expect(version).toBeTruthy();

    const rows = await db
      .select()
      .from(classroomFactsTable)
      .where(eq(classroomFactsTable.versionId, version!.id));

    expect(rows.length).toBe(1);
    expect(rows[0]!.statement).toBe("Textitie pricing starts at $5/mo.");
    expect(rows[0]!.sourceLabel).toBe("[Textitie] merged source");
    expect(rows[0]!.statement).not.toMatch(/textline/i);
    expect(rows[0]!.sourceLabel).not.toMatch(/textline/i);
  });
});
