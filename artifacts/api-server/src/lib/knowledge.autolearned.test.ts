import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  absorbedFactsTable,
  classroomVersionsTable,
  classroomFactsTable,
} from "@workspace/db";
import { approveAutoLearnedFact, rejectAutoLearnedFact } from "./knowledge";

// DB-backed: these helpers run real deterministic SQL (no LLM seam to stub).
// We assert classroom mutations + count recomputation against the real test DB,
// per the project's DB-backed test pattern (never vi.mock(@workspace/db)).

const RUN = `autolearn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let tenantId = 0;
let otherTenantId = 0;

async function seedAbsorbed(opts: {
  status: string;
  statement: string;
  sourceLabel?: string;
  conflictReason?: string | null;
  tokenCount?: number;
  category?: string;
}): Promise<number> {
  const [row] = await db
    .insert(absorbedFactsTable)
    .values({
      tenantId,
      sessionId: null,
      sourceLabel: opts.sourceLabel ?? "Professor escalation",
      statement: opts.statement,
      status: opts.status,
      category: opts.category ?? "general",
      source: "professor",
      conflictReason: opts.conflictReason ?? null,
      tokenCount: opts.tokenCount ?? 5,
    })
    .returning({ id: absorbedFactsTable.id });
  return row.id;
}

async function seedVersion(version: number) {
  const [v] = await db
    .insert(classroomVersionsTable)
    .values({
      tenantId,
      version,
      status: "published",
      summary: "test version",
      factCount: 0,
      tokenCount: 0,
    })
    .returning();
  return v;
}

async function seedClassroomFact(opts: {
  versionId: number;
  statement: string;
  sourceLabel: string;
  tokenCount?: number;
}) {
  await db.insert(classroomFactsTable).values({
    tenantId,
    versionId: opts.versionId,
    sourceLabel: opts.sourceLabel,
    statement: opts.statement,
    category: "general",
    tokenCount: opts.tokenCount ?? 3,
  });
}

async function classroomFactsFor(versionId: number) {
  return db
    .select({
      statement: classroomFactsTable.statement,
      sourceLabel: classroomFactsTable.sourceLabel,
      tokenCount: classroomFactsTable.tokenCount,
    })
    .from(classroomFactsTable)
    .where(eq(classroomFactsTable.versionId, versionId));
}

async function versionCounts(versionId: number) {
  const [v] = await db
    .select({
      factCount: classroomVersionsTable.factCount,
      tokenCount: classroomVersionsTable.tokenCount,
    })
    .from(classroomVersionsTable)
    .where(eq(classroomVersionsTable.id, versionId));
  return v;
}

async function absorbedStatus(factId: number) {
  const [row] = await db
    .select({
      status: absorbedFactsTable.status,
      conflictReason: absorbedFactsTable.conflictReason,
    })
    .from(absorbedFactsTable)
    .where(eq(absorbedFactsTable.id, factId));
  return row;
}

async function currentVersion() {
  const [v] = await db
    .select()
    .from(classroomVersionsTable)
    .where(
      and(
        eq(classroomVersionsTable.tenantId, tenantId),
        eq(classroomVersionsTable.status, "published"),
      ),
    )
    .orderBy(desc(classroomVersionsTable.version))
    .limit(1);
  return v ?? null;
}

async function cleanTenant(id: number) {
  await db.delete(classroomFactsTable).where(eq(classroomFactsTable.tenantId, id));
  await db
    .delete(classroomVersionsTable)
    .where(eq(classroomVersionsTable.tenantId, id));
  await db.delete(absorbedFactsTable).where(eq(absorbedFactsTable.tenantId, id));
}

beforeAll(async () => {
  const [t] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: `Auto-learn ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: `+1984${String(Date.now()).slice(-7)}`,
    })
    .returning({ id: tenantsTable.id });
  tenantId = t.id;

  const [o] = await db
    .insert(tenantsTable)
    .values({
      slug: `${RUN}-other`,
      name: `Other ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: `+1985${String(Date.now()).slice(-7)}`,
    })
    .returning({ id: tenantsTable.id });
  otherTenantId = o.id;
});

afterEach(async () => {
  await cleanTenant(tenantId);
});

afterAll(async () => {
  if (tenantId) await cleanTenant(tenantId);
  if (otherTenantId) await cleanTenant(otherTenantId);
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (otherTenantId)
    await db.delete(tenantsTable).where(eq(tenantsTable.id, otherTenantId));
});

describe("approveAutoLearnedFact", () => {
  it("promotes an auto_published fact to published without touching the Classroom", async () => {
    const factId = await seedAbsorbed({
      status: "auto_published",
      statement: "Onboarding takes about three business days.",
    });

    const res = await approveAutoLearnedFact(tenantId, factId);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.fact.status).toBe("published");
    expect((await absorbedStatus(factId)).status).toBe("published");
    // No Classroom version is created just by approving an already-groundable fact.
    expect(await currentVersion()).toBeNull();
  });

  it("inserts a conflict fact into the current published version and recomputes counts", async () => {
    const version = await seedVersion(1);
    await seedClassroomFact({
      versionId: version.id,
      statement: "Existing published truth.",
      sourceLabel: "Library",
      tokenCount: 4,
    });
    // Keep the stored count intentionally stale to prove recompute, not arithmetic.
    await db
      .update(classroomVersionsTable)
      .set({ factCount: 1, tokenCount: 4 })
      .where(eq(classroomVersionsTable.id, version.id));

    const factId = await seedAbsorbed({
      status: "conflict",
      statement: "Approved-over-conflict statement.",
      conflictReason: "Lexically overlaps an existing fact.",
      tokenCount: 7,
    });

    const res = await approveAutoLearnedFact(tenantId, factId);
    expect(res.ok).toBe(true);

    const facts = await classroomFactsFor(version.id);
    expect(facts.map((f) => f.statement)).toContain(
      "Approved-over-conflict statement.",
    );
    expect(facts).toHaveLength(2);

    const counts = await versionCounts(version.id);
    expect(counts.factCount).toBe(2);
    expect(counts.tokenCount).toBe(11); // 4 + 7, recomputed from rows

    const st = await absorbedStatus(factId);
    expect(st.status).toBe("published");
    expect(st.conflictReason).toBeNull();
  });

  it("creates v1 when approving a conflict fact and no published version exists", async () => {
    const factId = await seedAbsorbed({
      status: "conflict",
      statement: "First-ever fact via conflict approval.",
      tokenCount: 6,
    });

    const res = await approveAutoLearnedFact(tenantId, factId);
    expect(res.ok).toBe(true);

    const version = await currentVersion();
    expect(version).not.toBeNull();
    if (version) {
      expect(version.version).toBe(1);
      const facts = await classroomFactsFor(version.id);
      expect(facts).toHaveLength(1);
      expect(facts[0]?.statement).toBe("First-ever fact via conflict approval.");
      const counts = await versionCounts(version.id);
      expect(counts.factCount).toBe(1);
      expect(counts.tokenCount).toBe(6);
    }
  });
});

describe("rejectAutoLearnedFact", () => {
  it("removes the groundable row of an auto_published fact and recomputes counts", async () => {
    const version = await seedVersion(1);
    await seedClassroomFact({
      versionId: version.id,
      statement: "Keep me — unrelated truth.",
      sourceLabel: "Library",
      tokenCount: 2,
    });
    await seedClassroomFact({
      versionId: version.id,
      statement: "Remove me on reject.",
      sourceLabel: "Professor escalation",
      tokenCount: 9,
    });
    await db
      .update(classroomVersionsTable)
      .set({ factCount: 2, tokenCount: 11 })
      .where(eq(classroomVersionsTable.id, version.id));

    const factId = await seedAbsorbed({
      status: "auto_published",
      statement: "Remove me on reject.",
      sourceLabel: "Professor escalation",
      tokenCount: 9,
    });

    const res = await rejectAutoLearnedFact(tenantId, factId);
    expect(res.ok).toBe(true);

    const facts = await classroomFactsFor(version.id);
    expect(facts.map((f) => f.statement)).toEqual(["Keep me — unrelated truth."]);
    const counts = await versionCounts(version.id);
    expect(counts.factCount).toBe(1);
    expect(counts.tokenCount).toBe(2);
    expect((await absorbedStatus(factId)).status).toBe("rejected");
  });

  it("does NOT delete a different source's identical statement (exact-match guard)", async () => {
    const version = await seedVersion(1);
    // Same statement, two different sources. Rejecting the escalation fact must
    // only remove the escalation row, never the Library's identical statement.
    await seedClassroomFact({
      versionId: version.id,
      statement: "Shared statement text.",
      sourceLabel: "Library",
      tokenCount: 3,
    });
    await seedClassroomFact({
      versionId: version.id,
      statement: "Shared statement text.",
      sourceLabel: "Professor escalation",
      tokenCount: 3,
    });

    const factId = await seedAbsorbed({
      status: "auto_published",
      statement: "Shared statement text.",
      sourceLabel: "Professor escalation",
      tokenCount: 3,
    });

    const res = await rejectAutoLearnedFact(tenantId, factId);
    expect(res.ok).toBe(true);

    const facts = await classroomFactsFor(version.id);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.sourceLabel).toBe("Library");
    expect((await versionCounts(version.id)).factCount).toBe(1);
  });

  it("rejects a conflict fact by status only (no Classroom row to remove)", async () => {
    const version = await seedVersion(1);
    await seedClassroomFact({
      versionId: version.id,
      statement: "Untouched published truth.",
      sourceLabel: "Library",
      tokenCount: 5,
    });
    await db
      .update(classroomVersionsTable)
      .set({ factCount: 1, tokenCount: 5 })
      .where(eq(classroomVersionsTable.id, version.id));

    const factId = await seedAbsorbed({
      status: "conflict",
      statement: "Held conflict fact to reject.",
      conflictReason: "contradiction",
    });

    const res = await rejectAutoLearnedFact(tenantId, factId);
    expect(res.ok).toBe(true);

    expect((await absorbedStatus(factId)).status).toBe("rejected");
    const facts = await classroomFactsFor(version.id);
    expect(facts).toHaveLength(1);
    expect((await versionCounts(version.id)).factCount).toBe(1);
  });
});

describe("review guards", () => {
  it("returns not_found for a non-existent fact", async () => {
    expect(await approveAutoLearnedFact(tenantId, 999999999)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await rejectAutoLearnedFact(tenantId, 999999999)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns not_found when the fact belongs to another tenant (scoping)", async () => {
    const factId = await seedAbsorbed({
      status: "auto_published",
      statement: "Belongs to the primary tenant.",
    });
    expect(await approveAutoLearnedFact(otherTenantId, factId)).toEqual({
      ok: false,
      reason: "not_found",
    });
    // The fact is untouched.
    expect((await absorbedStatus(factId)).status).toBe("auto_published");
  });

  it("returns not_reviewable for a fact that is not auto_published/conflict", async () => {
    for (const status of ["published", "draft", "rejected"]) {
      const factId = await seedAbsorbed({
        status,
        statement: `A ${status} fact that is not reviewable.`,
      });
      expect(await approveAutoLearnedFact(tenantId, factId)).toEqual({
        ok: false,
        reason: "not_reviewable",
      });
      expect(await rejectAutoLearnedFact(tenantId, factId)).toEqual({
        ok: false,
        reason: "not_reviewable",
      });
    }
  });
});
