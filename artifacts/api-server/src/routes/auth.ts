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

export default router;
