import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  absorbedFactsTable,
  classroomVersionsTable,
  classroomFactsTable,
  professorSessionsTable,
  type AbsorbedFact,
  type ClassroomVersion,
  type ClassroomFact,
} from "@workspace/db";
import { adjudicateForPush } from "./librarian";
import { CLASSROOM_PUSH_LOCK } from "./knowledge";

/**
 * Shared Classroom snapshot publisher.
 *
 * A Classroom push is a FULL SNAPSHOT: it supersedes the current published
 * version and rebuilds a brand-new version from the accepted absorbed facts it
 * is handed. This single helper owns the one invariant that must never diverge
 * between callers — version numbering, the per-tenant advisory lock, superseding
 * the old version, inserting the new version + its facts, and flagging Librarian
 * conflicts atomically. The ONLY thing that varies between callers is whether
 * Professor sessions get marked "pushed" (a Professor-flow side effect):
 *
 *   - Professor push (routes/knowledge.ts): marks the sessions it consumed.
 *   - Brain push (routes/brain.ts): markSessions "none" — it must not disturb a
 *     Conductor's in-progress Professor sessions.
 *
 * Both pushes snapshot the UNION of every published absorbed fact (Professor +
 * approved Brain), so the live Classroom is always the complete picture and one
 * source can never wipe the other.
 */

export type MarkSessions =
  | { mode: "none" }
  | { mode: "active" }
  | { mode: "ids"; sessionIds: number[] };

export type PublishClassroomOutcome =
  | {
      ok: true;
      version: ClassroomVersion;
      facts: ClassroomFact[];
      mergedCount: number;
      conflictCount: number;
    }
  | { ok: false; reason: "all_conflict"; conflictCount: number };

export async function publishClassroomSnapshot(opts: {
  tenantId: number;
  /** Already-gathered absorbed facts with status "published" to snapshot. */
  factsToPublish: AbsorbedFact[];
  summary?: string | null;
  markSessions: MarkSessions;
}): Promise<PublishClassroomOutcome> {
  const { tenantId, factsToPublish, markSessions } = opts;
  const summary = opts.summary ?? null;

  // Librarian pass — collapse near-duplicate/refinement facts and FLAG
  // contradictions before snapshotting. Runs the (slow, read-only) Grok
  // adjudication BEFORE the transaction so we never hold the tx open across LLM
  // calls; all resulting writes are applied atomically inside the tx below.
  const verdict = await adjudicateForPush(
    factsToPublish.map((f) => ({
      id: f.id,
      statement: f.statement,
      category: f.category,
      sourceLabel: f.sourceLabel,
      tokenCount: f.tokenCount ?? 0,
    })),
  );

  const tokenCount = verdict.publish.reduce(
    (sum, f) => sum + (f.tokenCount ?? 0),
    0,
  );

  // Flag a contradiction onto its source absorbed facts. Guarded by tenantId
  // and status="published" so a fact the Conductor concurrently rejected (in
  // the window between adjudication and commit) is never clobbered.
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  const markConflicts = async (tx: Tx) => {
    for (const c of verdict.conflicts) {
      await tx
        .update(absorbedFactsTable)
        .set({ status: "conflict", conflictReason: c.reason })
        .where(
          and(
            eq(absorbedFactsTable.id, c.id),
            eq(absorbedFactsTable.tenantId, tenantId),
            eq(absorbedFactsTable.status, "published"),
          ),
        );
    }
  };

  // Everything collapsed into conflicts — nothing safe to publish. Still persist
  // the conflict flags so the Conductor can resolve them.
  if (verdict.publish.length === 0) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${tenantId}, ${CLASSROOM_PUSH_LOCK})`,
      );
      await markConflicts(tx);
    });
    return {
      ok: false,
      reason: "all_conflict",
      conflictCount: verdict.conflictCount,
    };
  }

  const snapshot = await db.transaction(async (tx) => {
    // Serialize pushes per tenant: with the lock held, concurrent pushes can't
    // duplicate version numbers or interleave published/superseded rows.
    // nextVersion is read INSIDE the lock so it reflects committed work.
    await tx.execute(
      sql`select pg_advisory_xact_lock(${tenantId}, ${CLASSROOM_PUSH_LOCK})`,
    );
    await markConflicts(tx);
    const [latest] = await tx
      .select({ version: classroomVersionsTable.version })
      .from(classroomVersionsTable)
      .where(eq(classroomVersionsTable.tenantId, tenantId))
      .orderBy(desc(classroomVersionsTable.version))
      .limit(1);
    const nextVersion = (latest?.version ?? 0) + 1;
    await tx
      .update(classroomVersionsTable)
      .set({ status: "superseded" })
      .where(
        and(
          eq(classroomVersionsTable.tenantId, tenantId),
          eq(classroomVersionsTable.status, "published"),
        ),
      );
    const [version] = await tx
      .insert(classroomVersionsTable)
      .values({
        tenantId,
        version: nextVersion,
        status: "published",
        summary,
        factCount: verdict.publish.length,
        tokenCount,
      })
      .returning();
    if (!version) throw new Error("Failed to create classroom version");
    const facts = await tx
      .insert(classroomFactsTable)
      .values(
        verdict.publish.map((f) => ({
          tenantId,
          versionId: version.id,
          sourceLabel: f.sourceLabel,
          statement: f.statement,
          category: f.category,
          tokenCount: f.tokenCount,
        })),
      )
      .returning();
    // Source absorbed facts stay "published" (they were already accepted and
    // remain the curation history); only conflicts were re-flagged above.
    // Optionally free the active-session slots that fed this Classroom version.
    if (markSessions.mode === "ids" && markSessions.sessionIds.length > 0) {
      await tx
        .update(professorSessionsTable)
        .set({ status: "pushed" })
        .where(
          and(
            eq(professorSessionsTable.tenantId, tenantId),
            inArray(professorSessionsTable.id, markSessions.sessionIds),
          ),
        );
    } else if (markSessions.mode === "active") {
      await tx
        .update(professorSessionsTable)
        .set({ status: "pushed" })
        .where(
          and(
            eq(professorSessionsTable.tenantId, tenantId),
            eq(professorSessionsTable.status, "active"),
          ),
        );
    }
    return { version, facts };
  });

  return {
    ok: true,
    version: snapshot.version,
    facts: snapshot.facts,
    mergedCount: verdict.mergedCount,
    conflictCount: verdict.conflictCount,
  };
}
