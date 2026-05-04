import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const email = process.env.SUPERUSER_EMAIL;
const password = process.env.SUPERUSER_PASSWORD;

if (!email || !password) {
  throw new Error("SUPERUSER_EMAIL and SUPERUSER_PASSWORD must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function hashPassword(pw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(pw, salt, 64, (err, key) => {
      if (err) reject(err);
      resolve(salt + ":" + key.toString("hex"));
    });
  });
}

async function main() {
  const hash = await hashPassword(password!);

  const result = await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = $2, role = $3
     RETURNING id, email, role`,
    [email, hash, "superuser"],
  );

  console.log("Super user upserted:", result.rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
