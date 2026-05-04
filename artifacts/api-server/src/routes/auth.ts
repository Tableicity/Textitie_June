import { Router } from "express";
import crypto from "node:crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function getSecret(): string {
  return process.env["SESSION_SECRET"] ?? "sama-dev-fallback-secret";
}

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

export function signToken(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(data)
    .digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
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
      userId: user.id,
      email: user.email,
      role: user.role,
      iat: Date.now(),
      exp: Date.now() + TOKEN_TTL_MS,
    });

    logger.info({ email: user.email, role: user.role }, "User logged in");
    res.json({ token, email: user.email, role: user.role });
  } catch (err) {
    logger.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/auth/users", async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        role: usersTable.role,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .orderBy(usersTable.id);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "List users error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/users", async (req, res) => {
  const { email, password, role } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  try {
    const hash = await hashPassword(password);
    const rows = await db
      .insert(usersTable)
      .values({ email, passwordHash: hash, role: role || "user" })
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        role: usersTable.role,
        createdAt: usersTable.createdAt,
      });

    logger.info({ email, role: role || "user" }, "User created");
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A user with that email already exists" });
      return;
    }
    logger.error({ err }, "Create user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/auth/users/:id/password", async (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body ?? {};

  if (!password || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  try {
    const hash = await hashPassword(password);
    const rows = await db
      .update(usersTable)
      .set({ passwordHash: hash })
      .where(eq(usersTable.id, id))
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        role: usersTable.role,
      });

    if (rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    logger.info({ userId: id, email: rows[0].email }, "Password reset");
    res.json({ message: "Password updated", user: rows[0] });
  } catch (err) {
    logger.error({ err }, "Password reset error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/auth/users/:id", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const rows = await db
      .delete(usersTable)
      .where(eq(usersTable.id, id))
      .returning({ id: usersTable.id, email: usersTable.email });

    if (rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    logger.info({ userId: id, email: rows[0].email }, "User deleted");
    res.json({ message: "User deleted" });
  } catch (err) {
    logger.error({ err }, "Delete user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
