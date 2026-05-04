import { Router } from "express";
import crypto from "node:crypto";
import {
  db,
  tenantUsersTable,
  departmentMembersTable,
  departmentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireTenantAuth } from "../middleware/tenantAuth";

const router = Router();

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      resolve(salt + ":" + key.toString("hex"));
    });
  });
}

router.get("/agents", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    const agents = await db
      .select({
        id: tenantUsersTable.id,
        email: tenantUsersTable.email,
        name: tenantUsersTable.name,
        role: tenantUsersTable.role,
        status: tenantUsersTable.status,
        skills: tenantUsersTable.skills,
        languages: tenantUsersTable.languages,
        lastAssignedAt: tenantUsersTable.lastAssignedAt,
        createdAt: tenantUsersTable.createdAt,
      })
      .from(tenantUsersTable)
      .where(eq(tenantUsersTable.tenantId, tenantId))
      .orderBy(tenantUsersTable.name);

    const agentsWithDepts = await Promise.all(
      agents.map(async (agent) => {
        const depts = await db
          .select({
            id: departmentsTable.id,
            name: departmentsTable.name,
          })
          .from(departmentMembersTable)
          .innerJoin(departmentsTable, eq(departmentMembersTable.departmentId, departmentsTable.id))
          .where(eq(departmentMembersTable.tenantUserId, agent.id));

        return {
          ...agent,
          skills: agent.skills ? agent.skills.split(",").map(s => s.trim()).filter(Boolean) : [],
          languages: agent.languages ? agent.languages.split(",").map(s => s.trim()).filter(Boolean) : [],
          departments: depts,
        };
      }),
    );

    res.json(agentsWithDepts);
  } catch (err) {
    req.log.error({ err }, "Failed to list agents");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/agents/invite", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const callerRole = req.tenantUser!.role;
  if (callerRole !== "admin") {
    res.status(403).json({ error: "Only admins can invite agents" });
    return;
  }

  const { email, name, password, role } = req.body ?? {};
  if (!email || !name || !password) {
    res.status(400).json({ error: "Email, name, and password are required" });
    return;
  }

  const validRoles = ["admin", "agent", "supervisor"];
  const assignRole = validRoles.includes(role) ? role : "agent";

  try {
    const existing = await db
      .select({ id: tenantUsersTable.id })
      .from(tenantUsersTable)
      .where(eq(tenantUsersTable.email, email))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "A user with this email already exists" });
      return;
    }

    const passwordHash = await hashPassword(password);
    const rows = await db
      .insert(tenantUsersTable)
      .values({
        tenantId,
        email,
        name,
        passwordHash,
        role: assignRole,
      })
      .returning({
        id: tenantUsersTable.id,
        email: tenantUsersTable.email,
        name: tenantUsersTable.name,
        role: tenantUsersTable.role,
        status: tenantUsersTable.status,
        createdAt: tenantUsersTable.createdAt,
      });

    res.status(201).json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to invite agent");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/agents/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const callerRole = req.tenantUser!.role;
  const agentId = Number(req.params.id);

  if (Number.isNaN(agentId)) {
    res.status(400).json({ error: "Invalid agent ID" });
    return;
  }

  const isSelf = req.tenantUser!.tenantUserId === agentId;
  if (!isSelf && callerRole !== "admin") {
    res.status(403).json({ error: "Only admins can update other agents" });
    return;
  }

  const { role, skills, languages, name } = req.body ?? {};

  try {
    const existing = await db
      .select({ id: tenantUsersTable.id })
      .from(tenantUsersTable)
      .where(and(eq(tenantUsersTable.id, agentId), eq(tenantUsersTable.tenantId, tenantId)))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (role !== undefined && callerRole === "admin") {
      const validRoles = ["admin", "agent", "supervisor"];
      if (validRoles.includes(role)) updates.role = role;
    }
    if (skills !== undefined) {
      updates.skills = Array.isArray(skills) ? skills.join(",") : skills;
    }
    if (languages !== undefined) {
      updates.languages = Array.isArray(languages) ? languages.join(",") : languages;
    }
    if (name !== undefined) updates.name = name;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    const rows = await db
      .update(tenantUsersTable)
      .set(updates)
      .where(eq(tenantUsersTable.id, agentId))
      .returning({
        id: tenantUsersTable.id,
        email: tenantUsersTable.email,
        name: tenantUsersTable.name,
        role: tenantUsersTable.role,
        status: tenantUsersTable.status,
        skills: tenantUsersTable.skills,
        languages: tenantUsersTable.languages,
        createdAt: tenantUsersTable.createdAt,
      });

    const agent = rows[0];
    res.json({
      ...agent,
      skills: agent.skills ? agent.skills.split(",").map(s => s.trim()).filter(Boolean) : [],
      languages: agent.languages ? agent.languages.split(",").map(s => s.trim()).filter(Boolean) : [],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update agent");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/agents/:id", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const callerRole = req.tenantUser!.role;
  const agentId = Number(req.params.id);

  if (callerRole !== "admin") {
    res.status(403).json({ error: "Only admins can deactivate agents" });
    return;
  }
  if (Number.isNaN(agentId)) {
    res.status(400).json({ error: "Invalid agent ID" });
    return;
  }
  if (req.tenantUser!.tenantUserId === agentId) {
    res.status(400).json({ error: "Cannot deactivate yourself" });
    return;
  }

  try {
    const existing = await db
      .select({ id: tenantUsersTable.id })
      .from(tenantUsersTable)
      .where(and(eq(tenantUsersTable.id, agentId), eq(tenantUsersTable.tenantId, tenantId)))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    await db.delete(tenantUsersTable).where(eq(tenantUsersTable.id, agentId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete agent");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/agents/status", requireTenantAuth, async (req, res) => {
  const userId = req.tenantUser!.tenantUserId;
  const { status } = req.body ?? {};

  const validStatuses = ["online", "offline", "away"];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: "Status must be online, offline, or away" });
    return;
  }

  try {
    const rows = await db
      .update(tenantUsersTable)
      .set({ status })
      .where(eq(tenantUsersTable.id, userId))
      .returning({
        id: tenantUsersTable.id,
        status: tenantUsersTable.status,
      });

    res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to update agent status");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
