import crypto from "node:crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      resolve(salt + ":" + key.toString("hex"));
    });
  });
}

export async function seedSuperuser(): Promise<void> {
  const email = "abc17@gmail.com";
  const password = "Whereisdad@1";
  const role = "superuser";

  try {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existing.length > 0) {
      logger.info({ email }, "Super user already exists, skipping seed");
      return;
    }

    const hash = await hashPassword(password);
    const rows = await db
      .insert(usersTable)
      .values({ email, passwordHash: hash, role })
      .returning({ id: usersTable.id, email: usersTable.email, role: usersTable.role });

    logger.info({ user: rows[0] }, "Super user seeded");
  } catch (err) {
    logger.error({ err }, "Failed to seed super user");
  }
}
