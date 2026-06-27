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
import { CLASSROOM_PUSH_LOCK, estimateTokens } from "./knowledge";
import { rebrandText } from "./brandSafety";

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
 * CALLER CONTRACT (not yet mechanically enforced here): every caller MUST pass
 * `factsToPublish` = the FULL union of this tenant's `status='published'`
 * absorbed facts (Professor + approved Brain). A subset would supersede the
 * prior version and silently drop everything not in the subset, so one source
 * could wipe the other. Both current callers (Professor push, Brain push) honor
 * this and are covered by regression tests.
 *
 * TODO(brain): read the published union INSIDE the advisory-locked transaction
 * here so the invariant can't be violated by a future caller and the
 * read-before-lock stale-snapshot race (acceptable today only for a manual
 * single-operator Conductor flow) is closed in one place. Blocked on the
 * Librarian (LLM) adjudication, which must run outside the transaction.
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

  // Brand-safety GATE (Layer 2): rewrite competitor names to the canonical brand
  // BEFORE Librarian adjudication, so dedup/conflict logic compares canonical
  // text AND the published Classroom — the closed book Auto-Pilot grounds on —
  // can never carry a competitor name. Every push self-heals: re-pushing a
  // tenant cleans any pre-existing facts (the only safe way to clean prod, which
  // the agent has read-only access to).
  const cleanedFacts = factsToPublish.map((f) => ({
    ...f,
    statement: rebrandText(f.statement).text,
    sourceLabel: rebrandText(f.sourceLabel).text,
  }));

  // Librarian pass — collapse near-duplicate/refinement facts and FLAG
  // contradictions before snapshotting. Runs the (slow, read-only) Grok
  // adjudication BEFORE the transaction so we never hold the tx open across LLM
  // calls; all resulting writes are applied atomically inside the tx below.
  const verdict = await adjudicateForPush(
    cleanedFacts.map((f) => ({
      id: f.id,
      statement: f.statement,
      category: f.category,
      sourceLabel: f.sourceLabel,
      tokenCount: f.tokenCount ?? 0,
    })),
  );

  // Final brand-safety pass on the ADJUDICATED output: the Librarian may emit a
  // brand-new `mergedStatement`, so we cannot rely on only scrubbing the inputs
  // above — scrub again here so nothing the closed-book Classroom grounds on can
  // ever carry a competitor name. Recompute token counts when the statement
  // actually changed so the version aggregate + per-fact counts stay accurate.
  const publish = verdict.publish.map((f) => {
    const statement = rebrandText(f.statement).text;
    const sourceLabel = rebrandText(f.sourceLabel).text;
    const tokenCount =
      statement === f.statement ? (f.tokenCount ?? 0) : estimateTokens(statement);
    return { ...f, statement, sourceLabel, tokenCount };
  });

  const tokenCount = publish.reduce((sum, f) => sum + (f.tokenCount ?? 0), 0);

  // Flag a contradiction onto its source absorbed facts. Guarded by tenantId
  // and an "active truth" status (published OR auto_published) so a fact the
  // Conductor concurrently rejected (in the window between adjudication and
  // commit) is never clobbered, while a self-learned `auto_published` fact that
  // turns out to contradict is still correctly demoted to `conflict` (otherwise
  // it would stay groundable and re-enter future push unions).
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
            inArray(absorbedFactsTable.status, ["published", "auto_published"]),
          ),
        );
    }
  };

  // Everything collapsed into conflicts — nothing safe to publish. Still persist
  // the conflict flags so the Conductor can resolve them.
  if (publish.length === 0) {
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
        factCount: publish.length,
        tokenCount,
      })
      .returning();
    if (!version) throw new Error("Failed to create classroom version");
    const facts = await tx
      .insert(classroomFactsTable)
      .values(
        publish.map((f) => ({
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
