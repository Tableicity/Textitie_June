import crypto from "node:crypto";
import { db, tenantUsersTable, tenantsTable } from "@workspace/db";
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

const SEED_USERS = [
  { email: "agent@acme.test", password: "tenant123", name: "ACME Agent", role: "agent" as const, tenantSlug: "acme" },
  { email: "abc17@gmail.com", password: "Whereisdad@1", name: "Admin User", role: "admin" as const, tenantSlug: "acme" },
];

export async function seedTenantUsers(missingTables: string[]): Promise<void> {
  if (missingTables.includes("tenant_users") || missingTables.includes("tenants")) {
    logger.warn("Skipping tenant user seed — required tables missing");
    return;
  }

  for (const seed of SEED_USERS) {
    try {
      const existing = await db
        .select({ id: tenantUsersTable.id })
        .from(tenantUsersTable)
        .where(eq(tenantUsersTable.email, seed.email))
        .limit(1);

      if (existing.length > 0) {
        logger.debug({ email: seed.email }, "Tenant user already exists, skipping");
        continue;
      }

      const tenants = await db
        .select({ id: tenantsTable.id })
        .from(tenantsTable)
        .where(eq(tenantsTable.slug, seed.tenantSlug))
        .limit(1);

      if (tenants.length === 0) {
        logger.warn({ tenantSlug: seed.tenantSlug, email: seed.email }, "Tenant not found for seed user, skipping");
        continue;
      }

      const hash = await hashPassword(seed.password);
      const rows = await db
        .insert(tenantUsersTable)
        .values({
          tenantId: tenants[0].id,
          email: seed.email,
          passwordHash: hash,
          name: seed.name,
          role: seed.role,
        })
        .returning({ id: tenantUsersTable.id, email: tenantUsersTable.email });

      logger.info({ user: rows[0], tenantSlug: seed.tenantSlug }, "Tenant user seeded");
    } catch (err) {
      logger.error({ err, email: seed.email }, "Failed to seed tenant user");
    }
  }
}
