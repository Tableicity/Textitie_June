import { Router } from "express";
import {
  db,
  departmentsTable,
  departmentMembersTable,
  tenantUsersTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireTenantAuth } from "../middleware/tenantAuth";
import { assertPaidTier } from "../lib/paidTierGate";

const router = Router();

router.get("/departments", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    const departments = await db
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.tenantId, tenantId))
      .orderBy(departmentsTable.createdAt);
    res.json(departments);
  } catch (err) {
    req.log.error({ err }, "Failed to list departments");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/departments", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { name, description } = req.body ?? {};
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  try {
    // Paid-tier gate: creating departments is a paid feature. The client
    // mirrors this gate for UX; this is the enforcement.
    const gate = await assertPaidTier(tenantId, "Creating departments");
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.message, code: gate.code });
      return;
    }
    const rows = await db
      .insert(departmentsTable)
      .values({ tenantId, name, description: description || null })
      .returning();
    res.status(201).json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to create department");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/departments/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid department ID" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, id), eq(departmentsTable.tenantId, tenantId)))
      .limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to get department");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/departments/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid department ID" });
    return;
  }
  const { name, description, routingStrategy } = req.body ?? {};
  const validStrategies = ["round_robin", "load_balanced", "last_assigned"];
  if (routingStrategy !== undefined && !validStrategies.includes(routingStrategy)) {
    res.status(400).json({ error: `Invalid routing strategy. Must be one of: ${validStrategies.join(", ")}` });
    return;
  }
  try {
    const existing = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, id), eq(departmentsTable.tenantId, tenantId)))
      .limit(1);
    if (existing.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (routingStrategy !== undefined) updates.routingStrategy = routingStrategy;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const rows = await db
      .update(departmentsTable)
      .set(updates)
      .where(eq(departmentsTable.id, id))
      .returning();
    res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to update department");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/departments/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid department ID" });
    return;
  }
  try {
    const existing = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, id), eq(departmentsTable.tenantId, tenantId)))
      .limit(1);
    if (existing.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    await db.delete(departmentsTable).where(eq(departmentsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete department");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/departments/:id/members", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const departmentId = Number(req.params.id);
  if (Number.isNaN(departmentId)) {
    res.status(400).json({ error: "Invalid department ID" });
    return;
  }
  try {
    const dept = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, departmentId), eq(departmentsTable.tenantId, tenantId)))
      .limit(1);
    if (dept.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    const members = await db
      .select({
        id: departmentMembersTable.id,
        tenantUserId: departmentMembersTable.tenantUserId,
        name: tenantUsersTable.name,
        email: tenantUsersTable.email,
        role: tenantUsersTable.role,
        createdAt: departmentMembersTable.createdAt,
      })
      .from(departmentMembersTable)
      .innerJoin(tenantUsersTable, eq(departmentMembersTable.tenantUserId, tenantUsersTable.id))
      .where(eq(departmentMembersTable.departmentId, departmentId));
    res.json(members);
  } catch (err) {
    req.log.error({ err }, "Failed to list department members");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/departments/:id/members", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const departmentId = Number(req.params.id);
  const { tenantUserId } = req.body ?? {};
  if (Number.isNaN(departmentId) || !tenantUserId) {
    res.status(400).json({ error: "Department ID and tenantUserId required" });
    return;
  }
  try {
    const dept = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, departmentId), eq(departmentsTable.tenantId, tenantId)))
      .limit(1);
    if (dept.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    const user = await db
      .select({ id: tenantUsersTable.id })
      .from(tenantUsersTable)
      .where(and(eq(tenantUsersTable.id, tenantUserId), eq(tenantUsersTable.tenantId, tenantId)))
      .limit(1);
    if (user.length === 0) {
      res.status(404).json({ error: "User not found in this tenant" });
      return;
    }
    const existing = await db
      .select()
      .from(departmentMembersTable)
      .where(and(
        eq(departmentMembersTable.departmentId, departmentId),
        eq(departmentMembersTable.tenantUserId, tenantUserId),
      ))
      .limit(1);
    if (existing.length > 0) {
      res.status(200).json(existing[0]);
      return;
    }
    const rows = await db
      .insert(departmentMembersTable)
      .values({ departmentId, tenantUserId })
      .returning();
    res.status(201).json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to add department member");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/departments/:id/members/:userId", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const departmentId = Number(req.params.id);
  const tenantUserId = Number(req.params.userId);
  if (Number.isNaN(departmentId) || Number.isNaN(tenantUserId)) {
    res.status(400).json({ error: "Invalid IDs" });
    return;
  }
  try {
    const dept = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, departmentId), eq(departmentsTable.tenantId, tenantId)))
      .limit(1);
    if (dept.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    await db
      .delete(departmentMembersTable)
      .where(
        and(
          eq(departmentMembersTable.departmentId, departmentId),
          eq(departmentMembersTable.tenantUserId, tenantUserId),
        ),
      );
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to remove department member");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
