import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  absorbedFactsTable,
  type AbsorbedFact,
  type ClassroomVersion,
} from "@workspace/db";
import {
  PullBrainKnowledgeBody,
  PushBrainToClassroomBody,
} from "@workspace/api-zod";
import {
  harvestFromBrain,
  brainConfigured,
  BrainNotConfiguredError,
} from "../lib/brainClient";
import { normalizeCategory, estimateTokens } from "../lib/knowledge";
import { publishClassroomSnapshot } from "../lib/classroomPublish";

/**
 * Brain ("Beast") manual-pull routes — the "Brain + Human" avenue that mirrors
 * "Human + Professor". A Conductor triggers a harvest; candidates are staged as
 * UNTRUSTED drafts in the SAME absorbed_facts pool (source="brain"), reviewed by
 * a human, then pushed through the SAME shared Classroom snapshot as Professor
 * facts. Brain content never auto-publishes and never wipes Professor facts —
 * the push always snapshots the UNION of every published absorbed fact.
 *
 * All paths live under `/tenants/:tenantId/...`, which is NOT in conductorAuth's
 * tenant-scoped allow-list, so these require Conductor (admin) auth by default.
 */

const router: IRouter = Router();

// Statuses that make a Brain candidate part of the actionable review queue.
const REVIEW_STATUSES = ["draft", "conflict"] as const;

function parseId(value: unknown): number | null {
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

async function getTenant(tenantId: number) {
  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  return tenant ?? null;
}

function toVersionApi(v: ClassroomVersion) {
  return {
    id: v.id,
    tenantId: v.tenantId,
    version: v.version,
    status: v.status,
    summary: v.summary,
    factCount: v.factCount,
    tokenCount: v.tokenCount,
    publishedAt: v.publishedAt,
  };
}

// App-level dedupe key: a Brain candidate is "the same" as an existing one when
// its statement matches after case-folding + whitespace collapse. Deliberately
// loose and cheap — the Librarian still does the semantic dedup at push time.
function dedupeKey(statement: string): string {
  return statement.trim().toLowerCase().replace(/\s+/g, " ");
}

// List the Brain review queue (source="brain", actionable statuses) for a tenant.
async function listBrainReviewQueue(tenantId: number): Promise<AbsorbedFact[]> {
  return db
    .select()
    .from(absorbedFactsTable)
    .where(
      and(
        eq(absorbedFactsTable.tenantId, tenantId),
        eq(absorbedFactsTable.source, "brain"),
        inArray(absorbedFactsTable.status, [...REVIEW_STATUSES]),
      ),
    )
    .orderBy(desc(absorbedFactsTable.createdAt));
}

// --- Pull --------------------------------------------------------------------

router.post(
  "/tenants/:tenantId/brain/pull",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const parsed = PullBrainKnowledgeBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid pull input" });
      return;
    }
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    if (!brainConfigured()) {
      res.status(503).json({
        error:
          "Brain is not configured. Set the BRAIN_BASE_URL and BRAIN_API_KEY secrets to enable knowledge pulls.",
      });
      return;
    }

    let harvest;
    try {
      harvest = await harvestFromBrain({
        tenantId,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        limit: parsed.data.limit,
      });
    } catch (err) {
      if (err instanceof BrainNotConfiguredError) {
        res.status(503).json({ error: err.message });
        return;
      }
      req.log.error({ err, tenantId }, "Brain harvest failed");
      res.status(502).json({
        error:
          "The Brain service could not be reached or returned an unusable response.",
      });
      return;
    }

    // Stage candidates as UNTRUSTED drafts. Dedupe against the existing Brain
    // review queue AND within this batch so re-pulling never piles up copies.
    const existing = await db
      .select({ statement: absorbedFactsTable.statement })
      .from(absorbedFactsTable)
      .where(
        and(
          eq(absorbedFactsTable.tenantId, tenantId),
          eq(absorbedFactsTable.source, "brain"),
        ),
      );
    const seen = new Set(existing.map((r) => dedupeKey(r.statement)));

    const toInsert: (typeof absorbedFactsTable.$inferInsert)[] = [];
    for (const c of harvest.items) {
      const key = dedupeKey(c.statement);
      if (seen.has(key)) continue;
      seen.add(key);
      toInsert.push({
        tenantId,
        sessionId: null,
        messageId: null,
        documentId: null,
        sourceLabel: c.title ? `[BRAIN] ${c.title}` : "[BRAIN]",
        statement: c.statement,
        category: normalizeCategory(c.categoryRaw),
        status: "draft",
        source: "brain",
        sourceUrl: c.sourceUrl,
        // Flagged candidates carry their reason here so the UI can render them
        // unchecked with an explanation (reuses the conflictReason column).
        conflictReason: c.flagReason,
        tokenCount: estimateTokens(c.statement),
      });
    }

    if (toInsert.length > 0) {
      await db.insert(absorbedFactsTable).values(toInsert);
    }

    const candidates = await listBrainReviewQueue(tenantId);
    res.json({
      candidates,
      pulledCount: harvest.items.length,
      insertedCount: toInsert.length,
      skippedCount: harvest.items.length - toInsert.length,
      stubbed: false,
    });
  },
);

// --- Candidates --------------------------------------------------------------

router.get(
  "/tenants/:tenantId/brain/candidates",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const candidates = await listBrainReviewQueue(tenantId);
    res.json(candidates);
  },
);

// --- Push --------------------------------------------------------------------

router.post(
  "/tenants/:tenantId/brain/push",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const parsed = PushBrainToClassroomBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid push input" });
      return;
    }
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const factIds = parsed.data.factIds;
    if (factIds.length === 0) {
      res.status(400).json({
        error: "Select at least one Brain candidate to approve before pushing.",
      });
      return;
    }

    // Human-in-the-loop gate: promote ONLY the selected Brain candidates to
    // "published". Scoped to this tenant + source="brain" + an actionable status
    // so this can never promote a Professor fact or an arbitrary id, and
    // accepting a flagged candidate clears its flag (a human adjudicated it).
    await db
      .update(absorbedFactsTable)
      .set({ status: "published", conflictReason: null })
      .where(
        and(
          eq(absorbedFactsTable.tenantId, tenantId),
          eq(absorbedFactsTable.source, "brain"),
          inArray(absorbedFactsTable.id, factIds),
          inArray(absorbedFactsTable.status, [...REVIEW_STATUSES]),
        ),
      );

    // Snapshot the UNION of every published absorbed fact (Professor + Brain) so
    // the Brain push never wipes Professor knowledge. markSessions "none" — a
    // Brain push must not disturb in-progress Professor sessions.
    const factsToPublish: AbsorbedFact[] = await db
      .select()
      .from(absorbedFactsTable)
      .where(
        and(
          eq(absorbedFactsTable.tenantId, tenantId),
          eq(absorbedFactsTable.status, "published"),
        ),
      );

    if (factsToPublish.length === 0) {
      res.status(400).json({
        error:
          "Nothing to publish — approve at least one candidate (none of the selected ids were pending Brain candidates).",
      });
      return;
    }

    const outcome = await publishClassroomSnapshot({
      tenantId,
      factsToPublish,
      summary: parsed.data.summary ?? null,
      markSessions: { mode: "none" },
    });

    if (!outcome.ok) {
      res.status(400).json({
        error:
          "All accepted facts are in conflict — resolve the flagged contradictions before publishing.",
        conflictCount: outcome.conflictCount,
      });
      return;
    }

    res.status(201).json({
      version: toVersionApi(outcome.version),
      facts: outcome.facts,
      factCount: outcome.facts.length,
      mergedCount: outcome.mergedCount,
      conflictCount: outcome.conflictCount,
    });
  },
);

export default router;
