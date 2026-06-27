import { Router } from "express";
import { db, contactsTable, conversationsTable } from "@workspace/db";
import { and, eq, desc, sql, ilike, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireTenantAuth } from "../middleware/tenantAuth";
import { recordAudit } from "../lib/audit";
import { enqueueSync } from "../lib/integrations/syncWorker";

function splitName(name: string | null): { firstName: string | null; lastName: string | null } {
  if (!name) return { firstName: null, lastName: null };
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

const router = Router();

router.get("/contacts", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const tag = typeof req.query.tag === "string" ? req.query.tag.trim() : "";
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 100;

  try {
    const conditions = [
      eq(contactsTable.tenantId, tenantId),
      // Quarantined imports stay hidden from the live contact list until flipped.
      eq(contactsTable.isQuarantined, false),
    ];
    if (q.length > 0) {
      const pat = `%${q}%`;
      const orExpr = or(
        ilike(contactsTable.name, pat),
        ilike(contactsTable.phone, pat),
        ilike(contactsTable.email, pat),
      );
      if (orExpr) conditions.push(orExpr);
    }
    if (tag.length > 0) {
      conditions.push(sql`${contactsTable.tags} @> ARRAY[${tag}]::text[]`);
    }

    const rows = await db
      .select()
      .from(contactsTable)
      .where(and(...conditions))
      .orderBy(desc(contactsTable.lastInteractionAt), desc(contactsTable.createdAt))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List contacts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/contacts/tags", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT UNNEST(tags) AS tag
      FROM contacts
      WHERE tenant_id = ${tenantId} AND tags IS NOT NULL AND is_quarantined = false
      ORDER BY tag ASC
    `);
    const tags = (result.rows as Array<{ tag: string }>).map((r) => r.tag).filter(Boolean);
    res.json(tags);
  } catch (err) {
    logger.error({ err }, "List contact tags error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/contacts/blocked-activity", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    // Blocked contacts, left-joined with aggregated suppressed-inbound audit
    // rows (action='inbound.blocked', entity_id = the sender phone). Both sides
    // are tenant-scoped. Numbers blocked but never re-attempted still appear
    // with attemptCount = 0.
    const result = await db.execute(sql`
      SELECT
        c.id AS id,
        c.phone AS phone,
        c.name AS name,
        c.updated_at AS blocked_at,
        COALESCE(a.attempt_count, 0)::int AS attempt_count,
        a.last_attempt_at AS last_attempt_at,
        a.last_preview AS last_attempt_preview
      FROM contacts c
      LEFT JOIN (
        SELECT
          entity_id,
          COUNT(*) AS attempt_count,
          MAX(created_at) AS last_attempt_at,
          (ARRAY_AGG(after_json->>'bodyPreview' ORDER BY created_at DESC))[1] AS last_preview
        FROM audit_logs
        WHERE tenant_id = ${tenantId} AND action = 'inbound.blocked'
        GROUP BY entity_id
      ) a ON a.entity_id = c.phone
      WHERE c.tenant_id = ${tenantId} AND c.blocked = true AND c.is_quarantined = false
      ORDER BY a.last_attempt_at DESC NULLS LAST, c.updated_at DESC
    `);
    const rows = result.rows as Array<{
      id: number;
      phone: string;
      name: string | null;
      blocked_at: string | null;
      attempt_count: number;
      last_attempt_at: string | null;
      last_attempt_preview: string | null;
    }>;
    res.json(
      rows.map((r) => ({
        id: r.id,
        phone: r.phone,
        name: r.name,
        blockedAt: r.blocked_at,
        attemptCount: r.attempt_count,
        lastAttemptAt: r.last_attempt_at,
        lastAttemptPreview: r.last_attempt_preview,
      })),
    );
  } catch (err) {
    logger.error({ err }, "List blocked activity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/contacts/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  try {
    const rows = await db
      .select()
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.id, id),
          eq(contactsTable.tenantId, tenantId),
          eq(contactsTable.isQuarantined, false),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    const conversations = await db
      .select({
        id: conversationsTable.id,
        status: conversationsTable.status,
        contactPhone: conversationsTable.contactPhone,
        lastMessageAt: conversationsTable.lastMessageAt,
        createdAt: conversationsTable.createdAt,
      })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.tenantId, tenantId),
          eq(conversationsTable.contactPhone, rows[0].phone),
          eq(conversationsTable.isQuarantined, false),
        ),
      )
      .orderBy(desc(conversationsTable.lastMessageAt))
      .limit(50);
    res.json({ ...rows[0], conversations });
  } catch (err) {
    logger.error({ err }, "Get contact error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/contacts", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { phone, name, email, notes, location, preferredLanguage, tags } = req.body ?? {};
  if (!phone || typeof phone !== "string" || phone.trim().length === 0) {
    res.status(400).json({ error: "phone is required" });
    return;
  }
  const cleanTags = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim()).slice(0, 50)
    : null;
  try {
    const rows = await db
      .insert(contactsTable)
      .values({
        tenantId,
        phone: phone.trim(),
        name: typeof name === "string" && name.trim().length > 0 ? name.trim() : null,
        email: typeof email === "string" && email.trim().length > 0 ? email.trim() : null,
        notes: typeof notes === "string" ? notes : null,
        location: typeof location === "string" && location.trim().length > 0 ? location.trim() : null,
        preferredLanguage:
          typeof preferredLanguage === "string" && preferredLanguage.trim().length > 0
            ? preferredLanguage.trim()
            : null,
        tags: cleanTags,
      })
      .returning();
    const created = rows[0];
    await recordAudit(req, {
      action: "contact.created",
      entityType: "contact",
      entityId: created.id,
      after: { phone: created.phone, name: created.name, tags: created.tags },
    });
    const { firstName, lastName } = splitName(created.name);
    await enqueueSync({
      tenantId,
      tenantSlug: req.tenantUser!.tenantSlug,
      provider: "hubspot",
      entityType: "contact",
      entityId: created.id,
      op: "upsert",
      payload: {
        phone: created.phone,
        email: created.email,
        firstName,
        lastName,
        tags: created.tags ?? [],
      },
    });
    res.status(201).json(created);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      res.status(409).json({ error: "A contact with this phone already exists" });
      return;
    }
    logger.error({ err }, "Create contact error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/contacts/block", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { phone, blocked } = req.body ?? {};
  if (!phone || typeof phone !== "string" || phone.trim().length === 0) {
    res.status(400).json({ error: "phone is required" });
    return;
  }
  if (typeof blocked !== "boolean") {
    res.status(400).json({ error: "blocked must be a boolean" });
    return;
  }
  const cleanPhone = phone.trim();
  try {
    const rows = await db
      .insert(contactsTable)
      .values({ tenantId, phone: cleanPhone, blocked })
      .onConflictDoUpdate({
        target: [contactsTable.tenantId, contactsTable.phone],
        // Match the partial-live unique index; blocking only ever targets a live
        // contact, never a quarantined TextLine import.
        targetWhere: eq(contactsTable.isQuarantined, false),
        set: { blocked, updatedAt: new Date() },
      })
      .returning();
    const updated = rows[0];
    await recordAudit(req, {
      action: blocked ? "contact.blocked" : "contact.unblocked",
      entityType: "contact",
      entityId: updated.id,
      after: { phone: updated.phone, blocked: updated.blocked },
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Set contact blocked error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/contacts/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  const { name, email, notes, location, preferredLanguage, tags } = req.body ?? {};
  const patch: Partial<typeof contactsTable.$inferInsert> = { updatedAt: new Date() };
  if (name !== undefined) patch.name = typeof name === "string" && name.trim().length > 0 ? name.trim() : null;
  if (email !== undefined) patch.email = typeof email === "string" && email.trim().length > 0 ? email.trim() : null;
  if (notes !== undefined) patch.notes = typeof notes === "string" ? notes : null;
  if (location !== undefined) patch.location = typeof location === "string" && location.trim().length > 0 ? location.trim() : null;
  if (preferredLanguage !== undefined) patch.preferredLanguage = typeof preferredLanguage === "string" && preferredLanguage.trim().length > 0 ? preferredLanguage.trim() : null;
  if (tags !== undefined) {
    patch.tags = Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim()).slice(0, 50)
      : null;
  }
  try {
    const before = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, id), eq(contactsTable.tenantId, tenantId), eq(contactsTable.isQuarantined, false)))
      .limit(1);
    const rows = await db
      .update(contactsTable)
      .set(patch)
      .where(and(eq(contactsTable.id, id), eq(contactsTable.tenantId, tenantId), eq(contactsTable.isQuarantined, false)))
      .returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    const updated = rows[0];
    await recordAudit(req, {
      action: "contact.updated",
      entityType: "contact",
      entityId: id,
      before: before[0],
      after: updated,
    });
    const { firstName, lastName } = splitName(updated.name);
    await enqueueSync({
      tenantId,
      tenantSlug: req.tenantUser!.tenantSlug,
      provider: "hubspot",
      entityType: "contact",
      entityId: id,
      op: "upsert",
      payload: {
        phone: updated.phone,
        email: updated.email,
        firstName,
        lastName,
        tags: updated.tags ?? [],
      },
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Update contact error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/contacts/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  try {
    const rows = await db
      .delete(contactsTable)
      .where(and(eq(contactsTable.id, id), eq(contactsTable.tenantId, tenantId), eq(contactsTable.isQuarantined, false)))
      .returning();
    if (rows.length === 0) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    await recordAudit(req, {
      action: "contact.deleted",
      entityType: "contact",
      entityId: id,
      before: rows[0],
    });
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Delete contact error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
