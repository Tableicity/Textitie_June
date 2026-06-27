import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, notInArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  migrationJobsTable,
  type MigrationJob,
} from "@workspace/db";
import { StartMigrationBody } from "@workspace/api-zod";
import { encryptToken } from "../lib/migrationCrypto";
import {
  transitionToHydrating,
  flipMigrationLive,
  discardMigration,
  pgErrorCode,
} from "../lib/migrationActions";

/**
 * TextLine Migration Assembly Line ("TextLine Smasher") — Conductor routes.
 *
 * All paths live under `/tenants/:tenantId/migrations...`, which is NOT in
 * conductorAuth's tenant-scoped allow-list, so these require Conductor (admin)
 * auth by default (mirrors the Brain routes).
 *
 * Phase 1 surface: start (create a pending job), list, and get/status. The
 * durable extract/verify worker (Phase 2) and hydrate / flip-live / discard
 * (Phase 3) are added in later phases.
 */

const router: IRouter = Router();

// A job in any of these statuses is finished and no longer occupies the tenant's
// single active-migration slot.
const TERMINAL_STATUSES = ["complete", "failed", "discarded"] as const;

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

// Map a job row to the API shape. CRITICAL: never expose access_token_enc.
function toJobApi(j: MigrationJob) {
  return {
    id: j.id,
    tenantId: j.tenantId,
    source: j.source,
    status: j.status,
    currentEntity: j.currentEntity,
    pageCursor: j.pageCursor,
    counts: j.counts,
    summary: j.summary,
    rateLimitedUntil: j.rateLimitedUntil,
    attempts: j.attempts,
    lastError: j.lastError,
    createdBy: j.createdBy,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
}

// --- Start -------------------------------------------------------------------

router.post(
  "/tenants/:tenantId/migrations",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const parsed = StartMigrationBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid migration input" });
      return;
    }
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    // One active migration per tenant: reject if a non-terminal job exists so a
    // second start can never race the worker over the same tenant's data.
    const [active] = await db
      .select({ id: migrationJobsTable.id })
      .from(migrationJobsTable)
      .where(
        and(
          eq(migrationJobsTable.tenantId, tenantId),
          notInArray(migrationJobsTable.status, [...TERMINAL_STATUSES]),
        ),
      )
      .limit(1);
    if (active) {
      res.status(409).json({
        error: "A migration is already in progress for this tenant.",
      });
      return;
    }

    let accessTokenEnc: string;
    try {
      // The token is the customer's credential — encrypt at rest, never log it.
      accessTokenEnc = encryptToken(parsed.data.accessToken);
    } catch (err) {
      req.log.error({ err, tenantId }, "Migration token encryption failed");
      res
        .status(500)
        .json({ error: "Could not securely store the access token." });
      return;
    }

    let job: MigrationJob;
    try {
      [job] = await db
        .insert(migrationJobsTable)
        .values({
          tenantId,
          source: "textline",
          status: "pending",
          accessTokenEnc,
          createdBy: null,
        })
        .returning();
    } catch (err) {
      // The app-level pre-check above is racy; the partial unique index
      // (one non-terminal job per tenant) is the real guard. A concurrent start
      // that lost the race surfaces here as a 23505 unique violation -> 409.
      // The code lives on the wrapped driver error's cause chain (Drizzle wraps
      // it), so unwrap before matching or this 409 silently degrades to a 500.
      if (pgErrorCode(err) === "23505") {
        res.status(409).json({
          error: "A migration is already in progress for this tenant.",
        });
        return;
      }
      req.log.error({ err, tenantId }, "Migration job insert failed");
      res.status(500).json({ error: "Could not start migration." });
      return;
    }

    req.log.info({ tenantId, jobId: job.id }, "Migration job created");
    res.status(201).json(toJobApi(job));
  },
);

// --- List --------------------------------------------------------------------

router.get(
  "/tenants/:tenantId/migrations",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const jobs = await db
      .select()
      .from(migrationJobsTable)
      .where(eq(migrationJobsTable.tenantId, tenantId))
      .orderBy(desc(migrationJobsTable.createdAt));
    res.json(jobs.map(toJobApi));
  },
);

// --- Get / status ------------------------------------------------------------

router.get(
  "/tenants/:tenantId/migrations/:jobId",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const jobId = parseId(req.params.jobId);
    if (tenantId == null || jobId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [job] = await db
      .select()
      .from(migrationJobsTable)
      .where(
        and(
          eq(migrationJobsTable.id, jobId),
          eq(migrationJobsTable.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!job) {
      res.status(404).json({ error: "Migration job not found" });
      return;
    }
    res.json(toJobApi(job));
  },
);

// --- Phase 3 operator actions ------------------------------------------------
//
// hydrate / flip-live / discard are Conductor-authed (paths NOT in the tenant
// allow-list). Each validates ids + job existence, then delegates the
// transactional, advisory-locked state transition to migrationActions.ts and
// maps the discriminated result to a precise HTTP status. The job is always
// re-loaded for the response so the client sees the post-transition state.

async function loadJob(
  tenantId: number,
  jobId: number,
): Promise<MigrationJob | null> {
  const [job] = await db
    .select()
    .from(migrationJobsTable)
    .where(
      and(
        eq(migrationJobsTable.id, jobId),
        eq(migrationJobsTable.tenantId, tenantId),
      ),
    )
    .limit(1);
  return job ?? null;
}

/** Validate ids + confirm the job exists, returning it (or sending 4xx). */
async function requireJob(
  req: Request,
  res: Response,
): Promise<{ tenantId: number; jobId: number; job: MigrationJob } | null> {
  const tenantId = parseId(req.params.tenantId);
  const jobId = parseId(req.params.jobId);
  if (tenantId == null || jobId == null) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  const job = await loadJob(tenantId, jobId);
  if (!job) {
    res.status(404).json({ error: "Migration job not found" });
    return null;
  }
  return { tenantId, jobId, job };
}

// Hydrate: open the worker's hydrate stage (review -> hydrating).
router.post(
  "/tenants/:tenantId/migrations/:jobId/hydrate",
  async (req: Request, res: Response): Promise<void> => {
    const ctx = await requireJob(req, res);
    if (!ctx) return;
    try {
      const result = await transitionToHydrating(ctx.tenantId, ctx.jobId);
      if (result.status === "queued" || result.status === "already_queued") {
        req.log.info(
          { tenantId: ctx.tenantId, jobId: ctx.jobId, result: result.status },
          "Migration hydrate queued",
        );
        const fresh = await loadJob(ctx.tenantId, ctx.jobId);
        res.json(toJobApi(fresh ?? ctx.job));
        return;
      }
      res.status(400).json({
        error: `Cannot hydrate a migration in '${result.current}' state — hydration is only available once verification finishes (status 'review').`,
      });
    } catch (err) {
      req.log.error({ err, jobId: ctx.jobId }, "Migration hydrate failed");
      res.status(500).json({ error: "Could not queue hydration." });
    }
  },
);

// Flip live: clear quarantine on a completed migration's rows.
router.post(
  "/tenants/:tenantId/migrations/:jobId/flip-live",
  async (req: Request, res: Response): Promise<void> => {
    const ctx = await requireJob(req, res);
    if (!ctx) return;
    try {
      const result = await flipMigrationLive(ctx.tenantId, ctx.jobId);
      if (result.status === "ok" || result.status === "already_flipped") {
        req.log.info(
          {
            tenantId: ctx.tenantId,
            jobId: ctx.jobId,
            result: result.status,
            merged: result.status === "ok" ? result.merged : undefined,
          },
          "Migration flipped live",
        );
        const fresh = await loadJob(ctx.tenantId, ctx.jobId);
        res.json(toJobApi(fresh ?? ctx.job));
        return;
      }
      if (result.status === "collision") {
        const list = result.phones.length > 0 ? `: ${result.phones.join(", ")}` : ".";
        res.status(409).json({
          error: `Cannot flip live — ${result.phones.length || "some"} imported phone number(s) already have live contacts that could not be auto-merged${list}`,
        });
        return;
      }
      res.status(400).json({
        error: `Cannot flip a migration in '${result.current}' state — flip-live requires a 'complete' migration.`,
      });
    } catch (err) {
      req.log.error({ err, jobId: ctx.jobId }, "Migration flip-live failed");
      res.status(500).json({ error: "Could not flip the migration live." });
    }
  },
);

// Discard: delete a migration's quarantined rows + staged data.
router.post(
  "/tenants/:tenantId/migrations/:jobId/discard",
  async (req: Request, res: Response): Promise<void> => {
    const ctx = await requireJob(req, res);
    if (!ctx) return;
    try {
      const result = await discardMigration(ctx.tenantId, ctx.jobId);
      if (result.status === "ok" || result.status === "already_discarded") {
        req.log.info(
          {
            tenantId: ctx.tenantId,
            jobId: ctx.jobId,
            result: result.status,
            deleted: result.status === "ok" ? result.deleted : undefined,
          },
          "Migration discarded",
        );
        const fresh = await loadJob(ctx.tenantId, ctx.jobId);
        res.json(toJobApi(fresh ?? ctx.job));
        return;
      }
      const why = result.flipped
        ? " (it has already been flipped live — its data is now live and protected)"
        : " — discard is only available once a migration is paused at review, has failed, or has completed without being flipped live";
      res.status(409).json({
        error: `Cannot discard a migration in '${result.current}' state${why}.`,
      });
    } catch (err) {
      req.log.error({ err, jobId: ctx.jobId }, "Migration discard failed");
      res.status(500).json({ error: "Could not discard the migration." });
    }
  },
);

export default router;
