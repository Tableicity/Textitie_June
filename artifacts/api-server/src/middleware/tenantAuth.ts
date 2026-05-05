import type { RequestHandler } from "express";
import { db, getTenantDb, type TenantDb } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyToken } from "../routes/auth";

export interface TenantAuthPayload {
  tenantUserId: number;
  tenantId: number;
  tenantSlug: string;
  email: string;
  role: string;
  scope: "tenant";
}

declare global {
  namespace Express {
    interface Request {
      tenantUser?: TenantAuthPayload;
      tenantDb?: TenantDb;
    }
  }
}

// Slug lookup cache for legacy tokens issued before tenantSlug was added.
// Token TTL is 24h; cache 1h is fine.
const slugCache = new Map<number, { slug: string; expires: number }>();
const SLUG_CACHE_TTL_MS = 60 * 60 * 1000;

async function lookupSlug(tenantId: number): Promise<string | null> {
  const cached = slugCache.get(tenantId);
  if (cached && cached.expires > Date.now()) return cached.slug;
  const rows = await db
    .select({ slug: tenantsTable.slug })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  if (rows.length === 0) return null;
  slugCache.set(tenantId, { slug: rows[0].slug, expires: Date.now() + SLUG_CACHE_TTL_MS });
  return rows[0].slug;
}

export const requireTenantAuth: RequestHandler = async (req, res, next) => {
  const header = req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const payload = verifyToken(header.slice(7)) as
    | (Partial<TenantAuthPayload> & { scope?: string })
    | null;
  if (!payload || payload.scope !== "tenant") {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // Backward-compat: tokens minted before Stage 4A don't carry tenantSlug.
  // Look it up from public.tenants and cache it for an hour.
  let tenantSlug = payload.tenantSlug;
  if (!tenantSlug && typeof payload.tenantId === "number") {
    const looked = await lookupSlug(payload.tenantId);
    if (!looked) {
      res.status(401).json({ error: "Tenant not found" });
      return;
    }
    tenantSlug = looked;
  }

  req.tenantUser = { ...payload, tenantSlug } as TenantAuthPayload;
  req.tenantDb = getTenantDb(tenantSlug as string);
  next();
};
