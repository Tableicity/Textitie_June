import { Router } from "express";
import crypto from "node:crypto";
import { db, tenantUsersTable, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { signToken } from "./auth";

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

function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(key.toString("hex") === hash);
    });
  });
}

router.post("/tenant-auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  try {
    const rows = await db
      .select({
        id: tenantUsersTable.id,
        tenantId: tenantUsersTable.tenantId,
        email: tenantUsersTable.email,
        name: tenantUsersTable.name,
        role: tenantUsersTable.role,
        passwordHash: tenantUsersTable.passwordHash,
        tenantSlug: tenantsTable.slug,
        tenantName: tenantsTable.name,
      })
      .from(tenantUsersTable)
      .innerJoin(tenantsTable, eq(tenantUsersTable.tenantId, tenantsTable.id))
      .where(eq(tenantUsersTable.email, email))
      .limit(1);

    if (rows.length === 0) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const user = rows[0];
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = signToken({
      tenantUserId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
      scope: "tenant",
      iat: Date.now(),
      exp: Date.now() + 24 * 60 * 60 * 1000,
    });

    logger.info(
      { email: user.email, tenantSlug: user.tenantSlug },
      "Tenant user logged in",
    );
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenantSlug: user.tenantSlug,
        tenantName: user.tenantName,
      },
    });
  } catch (err) {
    logger.error({ err }, "Tenant login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tenant-auth/me", async (req, res) => {
  const header = req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { verifyToken } = await import("./auth");
  const payload = verifyToken(header.slice(7));
  if (!payload || payload.scope !== "tenant") {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  try {
    const rows = await db
      .select({
        id: tenantUsersTable.id,
        tenantId: tenantUsersTable.tenantId,
        email: tenantUsersTable.email,
        name: tenantUsersTable.name,
        role: tenantUsersTable.role,
        tenantSlug: tenantsTable.slug,
        tenantName: tenantsTable.name,
      })
      .from(tenantUsersTable)
      .innerJoin(tenantsTable, eq(tenantUsersTable.tenantId, tenantsTable.id))
      .where(eq(tenantUsersTable.id, payload.tenantUserId as number))
      .limit(1);

    if (rows.length === 0) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    res.json({ user: rows[0] });
  } catch (err) {
    logger.error({ err }, "Tenant /me error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { hashPassword as hashTenantPassword };
export default router;
