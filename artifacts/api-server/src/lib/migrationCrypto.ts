import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * AES-256-GCM at-rest encryption for the tenant's TextLine access token.
 *
 * The token is the CUSTOMER's credential, not a platform secret. We hold it only
 * for the duration of a migration's extraction and clear it once the job ends.
 * It must never be logged and must never be stored in plaintext, so the
 * migration_jobs.access_token_enc column carries this ciphertext envelope.
 *
 * The key is derived deterministically from the platform SESSION_SECRET via
 * scrypt with a fixed, domain-separated salt, so a token encrypted in one
 * process restart stays decryptable in the next (no per-row key storage).
 */

const ALGORITHM = "aes-256-gcm";
const KEY_SALT = "sama-migration-token-v1";
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    // The token is a customer credential. In production we MUST have a real
    // SESSION_SECRET — never a shared, public dev fallback that would make the
    // at-rest ciphertext forgeable. Fail loud instead of silently weakening it.
    if (process.env["NODE_ENV"] === "production") {
      throw new Error(
        "SESSION_SECRET is required to encrypt migration access tokens in production",
      );
    }
    cachedKey = scryptSync("sama-dev-fallback-secret", KEY_SALT, 32);
    return cachedKey;
  }
  cachedKey = scryptSync(secret, KEY_SALT, 32);
  return cachedKey;
}

/**
 * Encrypt a plaintext token into a `iv:authTag:ciphertext` base64 envelope.
 */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt an envelope produced by {@link encryptToken}. Throws if the envelope
 * is malformed or authentication fails (tampering / wrong key).
 */
export function decryptToken(envelope: string): string {
  const [ivB64, tagB64, dataB64] = envelope.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted token envelope");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
