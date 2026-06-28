import { Router } from "express";
import crypto from "node:crypto";
import {
  db,
  tenantUsersTable,
  tenantsTable,
  emailVerificationsTable,
  departmentsTable,
  contactsTable,
  conversationsTable,
  messagesTable,
  dispositionsTable,
  ensureTenantSchema,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { signToken, verifyToken } from "./auth";
import { normalizePhoneE164 } from "../lib/phoneNumberRegistry";

const router = Router();

const MFA_PENDING_TTL_MS = 5 * 60 * 1000; // 5 min between phase 1 and phase 2
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

// Default dispositions every new tenant starts with so the inbox Resolve dialog
// is useful out of the box. Add new entries here to expand the seeded set — the
// `sortOrder` controls their order in the dropdown. Colors match the user-app's
// disposition palette (DISPOSITION_COLORS).
const SEED_DISPOSITIONS: { label: string; color: string }[] = [
  { label: "Active Lead", color: "#10b981" }, // green
  { label: "Do Not Contact", color: "#ef4444" }, // red
  { label: "No Longer Interested", color: "#f59e0b" }, // amber
];

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

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateCode(): string {
  // 6-digit, zero-padded
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const tail = local.slice(-2);
  return `****${tail}@${domain}`;
}

/**
 * Lab-mode plaintext code cache. Keyed by tenantUserId. Populated when a code
 * is issued, consumed by GET /tenant-auth/lab-code so the Verify page can
 * display it directly. NEVER ship this once SES is wired — delete the cache
 * and endpoint at that point.
 */
const labCodeCache = new Map<number, { code: string; expiresAt: number }>();

function rememberLabCode(tenantUserId: number, code: string): void {
  labCodeCache.set(tenantUserId, {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
}

function readLabCode(tenantUserId: number): string | null {
  const entry = labCodeCache.get(tenantUserId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    labCodeCache.delete(tenantUserId);
    return null;
  }
  return entry.code;
}

async function issueLabCode(tenantUserId: number, email: string): Promise<void> {
  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  rememberLabCode(tenantUserId, code);

  // Burn any previous unused codes so only the newest one is valid.
  await db
    .update(emailVerificationsTable)
    .set({ used: true })
    .where(
      and(
        eq(emailVerificationsTable.tenantUserId, tenantUserId),
        eq(emailVerificationsTable.used, false),
      ),
    );

  await db.insert(emailVerificationsTable).values({
    tenantUserId,
    codeHash,
    expiresAt,
    attempts: 0,
    used: false,
  });

  // Always log to console — this is how the lab card is filled in dev/beta.
  // eslint-disable-next-line no-console
  console.log(
    `\n========================================\n[LAB CODE] Code for ${email}: ${code}\n========================================\n`,
  );
  logger.info({ email, scope: "mfa" }, "Lab code issued");
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "tenant";
}

async function uniqueSlug(base: string): Promise<string> {
  const slug = slugify(base);
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const existing = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  throw new Error("Could not generate a unique slug");
}

router.post("/tenant-auth/register", async (req, res) => {
  const { companyName, email, password, plan, phone } = req.body ?? {};
  const trimmedCompanyName = typeof companyName === "string" ? companyName.trim() : "";
  if (!trimmedCompanyName || !email || !password) {
    res.status(400).json({ error: "Full name, email, and password are required" });
    return;
  }
  if (trimmedCompanyName.length > 200) {
    res.status(400).json({ error: "Name must be 200 characters or fewer" });
    return;
  }
  // Phone is required and must be a valid 10-digit US number (A2P 10DLC opt-in evidence).
  const phoneDigits = String(phone ?? "").replace(/\D/g, "");
  if (phoneDigits.length !== 10) {
    res.status(400).json({ error: "Enter a valid 10-digit US phone number" });
    return;
  }
  const normalizedPhone = phoneDigits;
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: "Please enter a valid email address" });
    return;
  }

  const isTrial = plan === "trial";
  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    // Reject duplicate emails up front (table also has unique constraint as a backstop)
    const existingUser = await db
      .select({ id: tenantUsersTable.id })
      .from(tenantUsersTable)
      .where(eq(tenantUsersTable.email, normalizedEmail))
      .limit(1);
    if (existingUser.length > 0) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }

    const slug = await uniqueSlug(trimmedCompanyName);
    const passwordHash = await hashPassword(password);

    const result = await db.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenantsTable)
        .values({
          slug,
          name: trimmedCompanyName,
          region: "US",
          tierCode: "starter",
          planTierCode: "starter",
          subscriptionStatus: isTrial ? "trialing" : "none",
          trialUsed: isTrial,
          trialEndsAt: isTrial
            ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
            : null,
        })
        .returning();

      const [user] = await tx
        .insert(tenantUsersTable)
        .values({
          tenantId: tenant.id,
          email: normalizedEmail,
          passwordHash,
          name: trimmedCompanyName,
          phone: normalizedPhone,
          role: "owner",
        })
        .returning();

      // Every new tenant starts with a default "Demo Department" so the agent
      // inbox is never empty — the inbox department filter no longer offers an
      // "All Departments"/"Unassigned" bucket, so a tenant with no department
      // would see an unusable, empty inbox. The owner is seeded as the first
      // contact (their own name + cell phone) with a welcome conversation that
      // lands inside the Demo Department, demonstrating two-way texting.
      //
      // The contact + conversation phone are canonicalized to E.164 so a real
      // text from the owner later matches this seeded conversation instead of
      // spawning a duplicate (the inbound webhook keys on the E.164 `From`).
      const e164Phone = normalizePhoneE164(normalizedPhone) ?? normalizedPhone;
      const [demoDept] = await tx
        .insert(departmentsTable)
        .values({
          tenantId: tenant.id,
          name: "Demo Department",
          description:
            "Your starter department. Create your own departments and add phone numbers once you're live.",
        })
        .returning({ id: departmentsTable.id });

      const [contact] = await tx
        .insert(contactsTable)
        .values({
          tenantId: tenant.id,
          phone: e164Phone,
          name: trimmedCompanyName,
        })
        .returning({ id: contactsTable.id });

      const seedNow = new Date();
      const [conversation] = await tx
        .insert(conversationsTable)
        .values({
          tenantId: tenant.id,
          departmentId: demoDept.id,
          contactId: contact.id,
          contactPhone: e164Phone,
          contactName: trimmedCompanyName,
          status: "open",
          lastMessageAt: seedNow,
        })
        .returning({ id: conversationsTable.id });

      await tx.insert(messagesTable).values({
        conversationId: conversation.id,
        direction: "inbound",
        body: `Welcome to Textitie, ${trimmedCompanyName}! This is your Demo Department. Reply here to see two-way texting in action, then create your own departments and add phone numbers when you're ready to go live.`,
        senderName: trimmedCompanyName,
        read: false,
      });

      // Seed default dispositions so the inbox Resolve dialog is useful out of
      // the box. The owner can edit/archive/add more in Settings → Dispositions.
      await tx.insert(dispositionsTable).values(
        SEED_DISPOSITIONS.map((d, i) => ({
          tenantId: tenant.id,
          label: d.label,
          color: d.color,
          sortOrder: i,
        })),
      );

      return { tenant, user };
    });

    logger.info(
      { email: normalizedEmail, tenantSlug: result.tenant.slug, plan: isTrial ? "trial" : "paid" },
      "New tenant registered",
    );

    // Provision the per-tenant Postgres schema for this new tenant.
    // Idempotent — no-op if already provisioned.
    try {
      await ensureTenantSchema(result.tenant.slug);
    } catch (provErr) {
      logger.error(
        { err: provErr, tenantSlug: result.tenant.slug },
        "Failed to provision tenant schema (tenant created, will retry on first use)",
      );
    }

    // Funnel new signups through the same MFA flow as login.
    await issueLabCode(result.user.id, result.user.email);

    const pendingToken = signToken({
      tenantUserId: result.user.id,
      tenantId: result.tenant.id,
      tenantSlug: result.tenant.slug,
      email: result.user.email,
      scope: "mfa-pending",
      iat: Date.now(),
      exp: Date.now() + MFA_PENDING_TTL_MS,
    });

    res.json({
      requiresMfa: true,
      pendingToken,
      maskedEmail: maskEmail(result.user.email),
    });
  } catch (err) {
    logger.error({ err }, "Tenant registration error");
    res.status(500).json({ error: "Could not create account" });
  }
});

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

    // Phase 1 done — issue lab code, return short-lived pending token.
    await issueLabCode(user.id, user.email);

    const pendingToken = signToken({
      tenantUserId: user.id,
      tenantId: user.tenantId,
      tenantSlug: user.tenantSlug,
      email: user.email,
      scope: "mfa-pending",
      iat: Date.now(),
      exp: Date.now() + MFA_PENDING_TTL_MS,
    });

    res.json({
      requiresMfa: true,
      pendingToken,
      maskedEmail: maskEmail(user.email),
    });
  } catch (err) {
    logger.error({ err }, "Tenant login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tenant-auth/verify-mfa", async (req, res) => {
  const { pendingToken, code } = req.body ?? {};
  if (!pendingToken || !code) {
    res.status(400).json({ error: "Pending token and code required" });
    return;
  }

  const payload = verifyToken(pendingToken);
  if (!payload || payload.scope !== "mfa-pending") {
    res.status(401).json({ error: "Pending session expired. Please sign in again." });
    return;
  }

  const tenantUserId = payload.tenantUserId as number;

  try {
    const [verification] = await db
      .select()
      .from(emailVerificationsTable)
      .where(
        and(
          eq(emailVerificationsTable.tenantUserId, tenantUserId),
          eq(emailVerificationsTable.used, false),
        ),
      )
      .orderBy(desc(emailVerificationsTable.createdAt))
      .limit(1);

    if (!verification) {
      res.status(400).json({ error: "No active code. Please request a new one." });
      return;
    }

    if (new Date(verification.expiresAt).getTime() < Date.now()) {
      res.status(400).json({ error: "Code has expired. Please request a new one." });
      return;
    }

    if (verification.attempts >= MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many attempts. Please request a new code." });
      return;
    }

    const submittedHash = hashCode(String(code).trim());
    if (submittedHash !== verification.codeHash) {
      await db
        .update(emailVerificationsTable)
        .set({ attempts: verification.attempts + 1 })
        .where(eq(emailVerificationsTable.id, verification.id));
      res.status(400).json({ error: "Invalid code." });
      return;
    }

    await db
      .update(emailVerificationsTable)
      .set({ used: true })
      .where(eq(emailVerificationsTable.id, verification.id));

    // Issue real session token
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
      .where(eq(tenantUsersTable.id, tenantUserId))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = rows[0];
    const token = signToken({
      tenantUserId: user.id,
      tenantId: user.tenantId,
      tenantSlug: user.tenantSlug,
      email: user.email,
      role: user.role,
      scope: "tenant",
      iat: Date.now(),
      exp: Date.now() + SESSION_TTL_MS,
    });

    logger.info(
      { email: user.email, tenantSlug: user.tenantSlug },
      "Tenant user MFA verified",
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
    logger.error({ err }, "MFA verify error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * LAB ONLY — returns the plaintext MFA code for a pending session so the
 * Verify page can display it. Remove this endpoint when SES email is wired.
 */
router.get("/tenant-auth/lab-code", async (req, res) => {
  const pendingToken = typeof req.query.pendingToken === "string"
    ? req.query.pendingToken
    : "";
  if (!pendingToken) {
    res.status(400).json({ error: "pendingToken required" });
    return;
  }
  const payload = verifyToken(pendingToken);
  if (!payload || payload.scope !== "mfa-pending") {
    res.status(401).json({ error: "Pending session expired" });
    return;
  }
  const code = readLabCode(payload.tenantUserId as number);
  if (!code) {
    res.status(404).json({ error: "No active lab code" });
    return;
  }
  res.json({ code });
});

router.post("/tenant-auth/resend-code", async (req, res) => {
  const { pendingToken } = req.body ?? {};
  if (!pendingToken) {
    res.status(400).json({ error: "Pending token required" });
    return;
  }

  const payload = verifyToken(pendingToken);
  if (!payload || payload.scope !== "mfa-pending") {
    res.status(401).json({ error: "Pending session expired. Please sign in again." });
    return;
  }

  const tenantUserId = payload.tenantUserId as number;
  const email = payload.email as string;

  try {
    const [recent] = await db
      .select()
      .from(emailVerificationsTable)
      .where(eq(emailVerificationsTable.tenantUserId, tenantUserId))
      .orderBy(desc(emailVerificationsTable.createdAt))
      .limit(1);

    if (recent) {
      const sinceMs = Date.now() - new Date(recent.createdAt).getTime();
      if (sinceMs < RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((RESEND_COOLDOWN_MS - sinceMs) / 1000);
        res.status(429).json({ error: `Please wait ${wait}s before requesting another code.` });
        return;
      }
    }

    await issueLabCode(tenantUserId, email);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "MFA resend error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tenant-auth/me", async (req, res) => {
  const header = req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

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

router.post("/tenant-auth/change-password", async (req, res) => {
  const header = req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const payload = verifyToken(header.slice(7));
  if (!payload || payload.scope !== "tenant") {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const { currentPassword, newPassword } = req.body ?? {};
  if (
    !currentPassword ||
    !newPassword ||
    typeof currentPassword !== "string" ||
    typeof newPassword !== "string"
  ) {
    res
      .status(400)
      .json({ error: "Current and new password are required" });
    return;
  }
  if (newPassword.length < 8) {
    res
      .status(400)
      .json({ error: "New password must be at least 8 characters" });
    return;
  }

  try {
    const rows = await db
      .select({
        id: tenantUsersTable.id,
        passwordHash: tenantUsersTable.passwordHash,
      })
      .from(tenantUsersTable)
      .where(eq(tenantUsersTable.id, payload.tenantUserId as number))
      .limit(1);

    if (rows.length === 0) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    const valid = await verifyPassword(currentPassword, rows[0].passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await db
      .update(tenantUsersTable)
      .set({ passwordHash })
      .where(eq(tenantUsersTable.id, rows[0].id));

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    logger.error({ err }, "Tenant change-password error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { hashPassword as hashTenantPassword };
export default router;
