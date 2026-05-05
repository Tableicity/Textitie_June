# Multi-Tenancy & Email MFA Authentication Guide

A comprehensive guide for implementing two key architectural features in a Replit full-stack application:  
**(A) PostgreSQL Schema-Per-Tenant Multi-Tenancy** and **(B) Email-Based MFA Login**

This guide is based on a production-tested implementation. Adapt table names, schema fields, and branding to fit your application.

---

## Table of Contents

1. [Part A: Multi-Tenancy Architecture](#part-a-multi-tenancy-architecture)
   - [Overview](#overview)
   - [Database Schema Design](#database-schema-design)
   - [Tenant Provisioning](#tenant-provisioning)
   - [Tenant Middleware](#tenant-middleware)
   - [DatabaseStorage Pattern](#databasestorage-pattern)
   - [Frontend Tenant Switching](#frontend-tenant-switching)
   - [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
2. [Part B: Email MFA Login](#part-b-email-mfa-login)
   - [Overview](#overview-1)
   - [Dependencies](#dependencies)
   - [Session Configuration](#session-configuration)
   - [Passport Local Strategy](#passport-local-strategy)
   - [Email Verification Module](#email-verification-module)
   - [Login Flow (Two-Phase)](#login-flow-two-phase)
   - [Frontend Auth Context](#frontend-auth-context)
   - [Login Page UI Flow](#login-page-ui-flow)
3. [Testing During Development](#testing-during-development)

---

## Part A: Multi-Tenancy Architecture

### Overview

The multi-tenancy model uses **PostgreSQL schema-per-tenant isolation**. Each tenant gets its own PostgreSQL schema (e.g., `tenant_acme`, `tenant_globex`), while shared platform data (users, tenants, sessions) lives in the `public` schema. This provides strong data isolation without running separate database instances.

**Key principle:** Application code never references a tenant schema directly. Instead, the PostgreSQL `search_path` is set per-connection, so the same SQL queries work transparently for any tenant.

### Database Schema Design

#### Platform Tables (public schema)

These tables exist once in the `public` schema and are shared across all tenants.

```typescript
// shared/schema.ts

// --- Users (platform-wide) ---
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: text("created_at"),
});

// --- Tenants ---
export const tenants = pgTable("tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),  // becomes the schema name: tenant_{slug}
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  ownerEmail: text("owner_email").notNull(),
  plan: text("plan").notNull().default("trial"),
  createdAt: text("created_at"),
});

// --- Tenant Members (links users to tenants with roles) ---
export const userRoleEnum = pgEnum("user_role", [
  "platform_admin",
  "tenant_admin",
  "tenant_staff",
  "shareholder",
]);

export const tenantMembers = pgTable("tenant_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  userId: varchar("user_id").notNull(),
  role: userRoleEnum("role").notNull().default("tenant_staff"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at"),
});

// --- Email Verifications ---
export const emailVerifications = pgTable("email_verifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  used: boolean("used").notNull().default(false),
  createdAt: text("created_at"),
});

// --- Sessions (auto-created by connect-pg-simple) ---
// Table name: "session" — created automatically, no Drizzle schema needed
```

#### Tenant Tables (per-schema)

Each tenant schema contains its own copies of these tables. Define them in the same `shared/schema.ts` file — the Drizzle ORM definitions are reused across all tenant schemas since the table structure is identical.

```typescript
// Example tenant-specific tables
export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  // ... your domain-specific fields
});

export const stakeholders = pgTable("stakeholders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  // ... etc
});
```

### Tenant Provisioning

When a new tenant is created, you must:
1. Create the PostgreSQL schema
2. Create all tenant-specific tables inside it
3. Link the owner user to the tenant via `tenant_members`

```typescript
// server/tenant.ts

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

// Cache tenant database connections
const tenantPools: Map<string, Pool> = new Map();
const tenantDbs: Map<string, ReturnType<typeof drizzle>> = new Map();

export function getTenantDb(slug: string) {
  if (tenantDbs.has(slug)) return tenantDbs.get(slug)!;

  const tenantPool = new Pool({ connectionString: process.env.DATABASE_URL });

  // KEY: Set search_path on every new connection to isolate tenant data
  tenantPool.on("connect", (client) => {
    client.query(`SET search_path TO "tenant_${slug}", public`);
  });

  const tenantDb = drizzle(tenantPool);
  tenantPools.set(slug, tenantPool);
  tenantDbs.set(slug, tenantDb);
  return tenantDb;
}

export async function provisionTenantSchema(slug: string) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // 1. Create the schema
    await client.query(`CREATE SCHEMA IF NOT EXISTS "tenant_${slug}"`);
    await client.query(`SET search_path TO "tenant_${slug}"`);

    // 2. Create all tenant-specific tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        created_at TEXT DEFAULT NOW()
        -- add your domain fields here
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS stakeholders (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'employee'
        -- add your domain fields here
      )
    `);

    // ... repeat for every tenant-specific table

    console.log(`[TENANT] Schema provisioned: tenant_${slug}`);
  } finally {
    client.release();
    await pool.end();
  }
}

// Called from the create-tenant API route
export async function createTenant(data: {
  slug: string;
  name: string;
  ownerEmail: string;
  plan?: string;
}) {
  // Insert into platform tenants table
  const [tenant] = await db.insert(tenants).values({
    slug: data.slug,
    name: data.name,
    ownerEmail: data.ownerEmail,
    plan: data.plan || "trial",
    createdAt: new Date().toISOString(),
  }).returning();

  // Provision the PostgreSQL schema with all tables
  await provisionTenantSchema(data.slug);

  return tenant;
}
```

**Important:** When you add new tables to your application, you must also add the `CREATE TABLE IF NOT EXISTS` statement to `provisionTenantSchema()`. For existing tenants, write a backfill function that iterates over all tenant schemas and adds the new table.

### Tenant Middleware

The middleware identifies which tenant the request is targeting, verifies access, and attaches a tenant-specific storage instance to the request.

```typescript
// server/routes.ts

import { getTenantDb } from "./tenant";
import { DatabaseStorage, createTenantStorage } from "./storage";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      tenantSlug?: string;
      tenantRole?: string;
      tenantStorage?: DatabaseStorage;
    }
  }
}

async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Identify tenant from query param or header
  const slug = (req.query.tenant as string) || req.headers["x-tenant-id"] as string;
  if (!slug) {
    return res.status(400).json({ message: "Tenant identifier required" });
  }

  // 2. Verify tenant exists
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  if (!tenant) {
    return res.status(404).json({ message: "Tenant not found" });
  }

  // 3. Verify user has access to this tenant
  const role = await getUserTenantRole(req.user!.id, slug);
  if (!role) {
    return res.status(403).json({ message: "Access denied to this organization" });
  }

  // 4. Attach tenant context to request
  req.tenantSlug = slug;
  req.tenantRole = role;
  req.tenantStorage = createTenantStorage(getTenantDb(slug));

  next();
}

// Role checker helper
function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantRole || !allowedRoles.includes(req.tenantRole)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
}

// Usage in routes:
app.get("/api/stakeholders",
  requireAuth,
  tenantMiddleware,
  requireRole(["tenant_admin", "tenant_staff"]),
  async (req, res) => {
    const stakeholders = await req.tenantStorage!.getStakeholders(companyId);
    res.json(stakeholders);
  }
);
```

### DatabaseStorage Pattern

The `DatabaseStorage` class provides CRUD operations using a Drizzle database instance. The same class works for both platform and tenant operations — the only difference is which database connection (and therefore which schema) it uses.

```typescript
// server/storage.ts

export interface IStorage {
  // Define all CRUD operations your app needs
  getStakeholders(companyId: string): Promise<Stakeholder[]>;
  createStakeholder(data: InsertStakeholder): Promise<Stakeholder>;
  updateStakeholder(id: string, data: Partial<Stakeholder>): Promise<Stakeholder>;
  deleteStakeholder(id: string): Promise<void>;
  // ... etc
}

export class DatabaseStorage implements IStorage {
  constructor(private _db: ReturnType<typeof drizzle> = db) {}

  async getStakeholders(companyId: string): Promise<Stakeholder[]> {
    return this._db
      .select()
      .from(stakeholders)
      .where(eq(stakeholders.companyId, companyId));
  }

  async createStakeholder(data: InsertStakeholder): Promise<Stakeholder> {
    const [result] = await this._db
      .insert(stakeholders)
      .values(data)
      .returning();
    return result;
  }

  // ... implement all IStorage methods
}

// Factory function for tenant-specific storage
export function createTenantStorage(tenantDb: ReturnType<typeof drizzle>): DatabaseStorage {
  return new DatabaseStorage(tenantDb);
}

// Default platform storage (uses public schema)
export const storage = new DatabaseStorage();
```

### Frontend Tenant Switching

On the frontend, maintain the current tenant in React context and localStorage. Append the tenant slug to every API request.

```typescript
// client/src/lib/tenant-context.tsx

import { createContext, useContext, useState, type ReactNode } from "react";

type TenantContextType = {
  currentTenant: string | null;
  setCurrentTenant: (slug: string) => void;
};

const TenantContext = createContext<TenantContextType | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const [currentTenant, setTenant] = useState<string | null>(() => {
    return localStorage.getItem("app_tenant") || null;
  });

  function setCurrentTenant(slug: string) {
    setTenant(slug);
    localStorage.setItem("app_tenant", slug);
  }

  return (
    <TenantContext.Provider value={{ currentTenant, setCurrentTenant }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext)!;
}

// Helper to append tenant param to API URLs
export function appendTenantParam(url: string): string {
  const tenant = localStorage.getItem("app_tenant");
  if (!tenant) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}tenant=${tenant}`;
}
```

**Usage in TanStack Query:**

```typescript
// Override the default query function to include tenant param
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => {
        const url = appendTenantParam(queryKey[0] as string);
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
    },
  },
});
```

### Role-Based Access Control (RBAC)

Four roles, hierarchically ordered:

| Role | Scope | Access Level |
|------|-------|-------------|
| `platform_admin` | All tenants | Full access everywhere, system settings |
| `tenant_admin` | One tenant | Full CRUD on that tenant's data |
| `tenant_staff` | One tenant | Standard read/write, no delete on sensitive items |
| `shareholder` | One tenant | Read-only access to their own positions |

**Key rule:** If `user.isPlatformAdmin === true`, they are granted `platform_admin` role on any tenant, regardless of the `tenant_members` table.

```typescript
// server/auth.ts

export async function getUserTenantRole(
  userId: string,
  tenantSlug: string
): Promise<string | null> {
  // Platform admins have access to everything
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user?.isPlatformAdmin) return "platform_admin";

  // Check tenant membership
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug));
  if (!tenant) return null;

  const [membership] = await db
    .select()
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.tenantId, tenant.id),
        eq(tenantMembers.status, "active")
      )
    );

  return membership?.role || null;
}
```

---

## Part B: Email MFA Login

### Overview

The login system uses a **two-phase authentication flow**:

1. **Phase 1 — Credential Check:** User submits email + password. Server validates via Passport.js but does NOT log the user in yet. Instead, it generates a 6-digit code and emails it (and logs it to console for dev testing).

2. **Phase 2 — MFA Verification:** User enters the 6-digit code. Server validates the code, then completes the login via `req.login()`.

This approach ensures that even if credentials are compromised, an attacker cannot log in without access to the email account.

### Dependencies

Install these packages:

```
express-session
connect-pg-simple
passport
passport-local
bcryptjs
```

Types (dev dependencies):
```
@types/express-session
@types/passport
@types/passport-local
@types/bcryptjs
```

### Session Configuration

```typescript
// server/auth.ts

import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";

export function setupAuth(app: Express) {
  const PgSession = connectPgSimple(session);

  app.use(
    session({
      store: new PgSession({
        pool: pool as any,        // your pg Pool instance
        tableName: "session",     // auto-creates if missing
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
        httpOnly: true,
        sameSite: "lax",
        secure: false,  // set to true in production with HTTPS
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());
}
```

**Note:** The `SESSION_SECRET` should be stored as a Replit Secret (environment variable). Never hardcode production secrets.

### Passport Local Strategy

```typescript
// server/auth.ts (continued)

import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";

passport.use(
  new LocalStrategy(
    { usernameField: "email", passwordField: "password" },
    async (email, password, done) => {
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase()));

        if (!user) {
          return done(null, false, { message: "Invalid email or password" });
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          return done(null, false, { message: "Invalid email or password" });
        }

        return done(null, {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isPlatformAdmin: user.isPlatformAdmin,
          emailVerified: user.emailVerified,
        });
      } catch (err) {
        return done(err);
      }
    }
  )
);

// Serialize: store only user ID in session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize: fetch full user on each request
passport.deserializeUser(async (id: string, done) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) return done(null, false);
    done(null, {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isPlatformAdmin: user.isPlatformAdmin,
      emailVerified: user.emailVerified,
    });
  } catch (err) {
    done(err);
  }
});
```

**Registration (password hashing):**

```typescript
app.post("/api/auth/register", async (req, res) => {
  const { email, password, firstName, lastName } = req.body;

  // Hash with salt factor 12
  const passwordHash = await bcrypt.hash(password, 12);

  const [user] = await db.insert(users).values({
    email: email.toLowerCase(),
    passwordHash,
    firstName,
    lastName,
    createdAt: new Date().toISOString(),
  }).returning();

  // ... login the user or send verification email
});
```

### Email Verification Module

This module handles MFA code generation, storage, validation, and delivery.

```typescript
// server/email-verification.ts

import crypto from "crypto";
import bcrypt from "bcryptjs";

// Generate a 6-digit numeric code
function generateCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

// Create and store a verification code
export async function createVerificationCode(userId: string): Promise<string> {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  await db.insert(emailVerifications).values({
    userId,
    codeHash,
    expiresAt,
    attempts: 0,
    used: false,
    createdAt: new Date().toISOString(),
  });

  return code;
}

// Verify a submitted code
export async function verifyCode(
  userId: string,
  code: string
): Promise<{ success: boolean; message: string }> {
  // Get the most recent unused code for this user
  const [verification] = await db
    .select()
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.userId, userId),
        eq(emailVerifications.used, false)
      )
    )
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);

  if (!verification) {
    return { success: false, message: "No verification code found. Please request a new one." };
  }

  // Check expiry (10 minutes)
  if (new Date(verification.expiresAt) < new Date()) {
    return { success: false, message: "Verification code has expired. Please request a new one." };
  }

  // Check attempt limit (max 5)
  if (verification.attempts >= 5) {
    return { success: false, message: "Too many failed attempts. Please request a new code." };
  }

  // Validate code against stored hash
  const isValid = await bcrypt.compare(code, verification.codeHash);

  if (!isValid) {
    // Increment attempt counter
    await db
      .update(emailVerifications)
      .set({ attempts: verification.attempts + 1 })
      .where(eq(emailVerifications.id, verification.id));
    return { success: false, message: "Invalid verification code." };
  }

  // Mark code as used
  await db
    .update(emailVerifications)
    .set({ used: true })
    .where(eq(emailVerifications.id, verification.id));

  // Mark user as email-verified
  await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.id, userId));

  return { success: true, message: "Email verified successfully." };
}

// Send verification email
// CRITICAL: Always log to console for development testing
export async function sendVerificationEmail(email: string, code: string): Promise<void> {
  // Always log — this is how you retrieve the code during development
  console.log(`\n========================================`);
  console.log(`[EMAIL VERIFICATION] Code for ${email}: ${code}`);
  console.log(`========================================\n`);

  // Optional: Send via AWS SES if credentials are configured
  // If not configured, the console log above is the only delivery method
  const hasAwsCreds = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
  if (hasAwsCreds) {
    // ... AWS SES send logic (see production section below)
  }
}

// Rate limiting: prevent code spam (1 code per 60 seconds)
export async function canResendCode(userId: string): Promise<boolean> {
  const [recent] = await db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.userId, userId))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);

  if (!recent) return true;
  const timeSince = Date.now() - new Date(recent.createdAt).getTime();
  return timeSince > 60 * 1000; // 60 seconds cooldown
}
```

### Login Flow (Two-Phase)

```typescript
// server/auth.ts — Login Routes

// PHASE 1: Validate credentials, send MFA code
app.post("/api/auth/login", (req, res, next) => {
  passport.authenticate("local", async (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).json({ message: info?.message || "Invalid credentials" });
    }

    try {
      // Store user ID in session (but do NOT call req.login yet)
      (req.session as any).pendingMfaUserId = user.id;
      (req.session as any).pendingMfaEmail = user.email;

      // Force session save before responding
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Generate and send the 6-digit code
      const code = await createVerificationCode(user.id);
      await sendVerificationEmail(user.email, code);

      // Respond with masked email (e.g., "****17@gmail.com")
      const maskedEmail = maskEmail(user.email);
      return res.json({ requiresMfa: true, maskedEmail });
    } catch (mfaErr) {
      return res.status(500).json({ message: "Failed to send verification code" });
    }
  })(req, res, next);
});

// PHASE 2: Verify MFA code, complete login
app.post("/api/auth/verify-login-mfa", async (req, res) => {
  const pendingUserId = (req.session as any).pendingMfaUserId;
  const pendingEmail = (req.session as any).pendingMfaEmail;

  if (!pendingUserId || !pendingEmail) {
    return res.status(400).json({ message: "No pending login. Please sign in again." });
  }

  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ message: "Security code is required" });
  }

  const result = await verifyCode(pendingUserId, code);
  if (!result.success) {
    return res.status(400).json({ message: result.message });
  }

  // Fetch full user from DB
  const [dbUser] = await db.select().from(users).where(eq(users.id, pendingUserId));
  if (!dbUser) {
    return res.status(400).json({ message: "User not found" });
  }

  // Clear pending MFA session data
  delete (req.session as any).pendingMfaUserId;
  delete (req.session as any).pendingMfaEmail;

  // NOW complete the login
  const sessionUser = {
    id: dbUser.id,
    email: dbUser.email,
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    isPlatformAdmin: dbUser.isPlatformAdmin,
    emailVerified: true,
  };

  req.login(sessionUser, (loginErr) => {
    if (loginErr) {
      return res.status(500).json({ message: "Login failed after verification" });
    }
    return res.json({ ...sessionUser, requiresVerification: false });
  });
});

// RESEND CODE (with rate limiting)
app.post("/api/auth/resend-login-code", async (req, res) => {
  const pendingUserId = (req.session as any).pendingMfaUserId;
  const pendingEmail = (req.session as any).pendingMfaEmail;

  if (!pendingUserId || !pendingEmail) {
    return res.status(400).json({ message: "No pending login." });
  }

  const allowed = await canResendCode(pendingUserId);
  if (!allowed) {
    return res.status(429).json({ message: "Please wait 60 seconds before requesting a new code." });
  }

  const code = await createVerificationCode(pendingUserId);
  await sendVerificationEmail(pendingEmail, code);

  return res.json({ message: "New code sent." });
});

// AUTH CHECK (used by frontend to verify session)
app.get("/api/auth/me", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  res.json(req.user);
});

// LOGOUT
app.post("/api/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ message: "Logout failed" });
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });
});

// Helper: requireAuth middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}
```

### Frontend Auth Context

```typescript
// client/src/lib/auth-context.tsx

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ requiresMfa: boolean; maskedEmail?: string }>;
  verifyLoginMfa: (code: string) => Promise<User>;
  resendCode: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        setUser(await res.json());
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  async function login(email: string, password: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message);
    }
    return res.json(); // { requiresMfa: true, maskedEmail: "****17@gmail.com" }
  }

  async function verifyLoginMfa(code: string) {
    const res = await fetch("/api/auth/verify-login-mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message);
    }
    const userData = await res.json();
    setUser(userData);
    return userData;
  }

  async function resendCode() {
    const res = await fetch("/api/auth/resend-login-code", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, verifyLoginMfa, resendCode, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext)!;
}
```

### Login Page UI Flow

The login page has two visual states:

1. **Email + Password form** — shown initially
2. **MFA Code entry** — shown after successful credential check

```
State Machine:
┌─────────────────┐     credentials OK     ┌──────────────────┐
│  Email/Password │ ──────────────────────> │  Enter 6-digit   │
│  Form           │                         │  Code            │
└─────────────────┘                         └──────────────────┘
                                                  │
                                            code verified
                                                  │
                                                  v
                                            ┌──────────┐
                                            │ Dashboard │
                                            └──────────┘
```

**Key UI state variables:**
```typescript
const [isVerifying, setIsVerifying] = useState(false);  // toggles between forms
const [maskedEmail, setMaskedEmail] = useState("");      // e.g., "****17@gmail.com"
const [code, setCode] = useState("");                    // 6-digit input
```

**Login handler:**
```typescript
async function handleLogin() {
  const result = await login(email, password);
  if (result.requiresMfa) {
    setIsVerifying(true);
    setMaskedEmail(result.maskedEmail);
  }
}
```

**MFA verification handler:**
```typescript
async function handleVerifyCode() {
  await verifyLoginMfa(code);
  navigate("/dashboard");
}
```

---

## Testing During Development

### Retrieving MFA Codes from Logs

During development, verification codes are always logged to the server console regardless of whether AWS SES is configured. Look for this pattern in your workflow logs:

```
========================================
[EMAIL VERIFICATION] Code for user@example.com: 847291
========================================
```

**How to find it:**
1. Open your Replit workflow logs (the "Start application" workflow)
2. After submitting login credentials, look for the `[EMAIL VERIFICATION]` line
3. Copy the 6-digit code and enter it in the MFA screen

### Test Account Setup

To create a test admin account via seed data:

```typescript
// server/seed.ts
const passwordHash = await bcrypt.hash("admin123!", 12);
const [adminUser] = await db.insert(users).values({
  email: "admin@yourapp.com",
  passwordHash,
  firstName: "Admin",
  lastName: "User",
  isPlatformAdmin: true,
  emailVerified: true,
  createdAt: new Date().toISOString(),
}).returning();

// Link to a tenant
await db.insert(tenantMembers).values({
  tenantId: tenant.id,
  userId: adminUser.id,
  role: "tenant_admin",
  createdAt: new Date().toISOString(),
});
```

### Common Issues

| Issue | Solution |
|-------|---------|
| Session not persisting | Ensure `credentials: "include"` on all fetch calls |
| MFA code not found in logs | Check the workflow console output, not browser console |
| "No pending login" error | Session may have expired between Phase 1 and Phase 2; ensure `req.session.save()` is called after setting pending MFA data |
| Tenant not found | Verify the tenant slug matches exactly (case-sensitive) |
| Password validation fails | Ensure bcrypt salt factor matches between hash and compare |
| Code expired | Codes last 10 minutes; request a new one via resend endpoint |

---

## File Reference

| File | Purpose |
|------|---------|
| `shared/schema.ts` | All Drizzle table definitions (platform + tenant) |
| `server/auth.ts` | Session setup, Passport config, login/register routes |
| `server/email-verification.ts` | MFA code generation, validation, email sending |
| `server/tenant.ts` | Schema provisioning, tenant DB pool management |
| `server/storage.ts` | IStorage interface + DatabaseStorage implementation |
| `server/routes.ts` | Tenant middleware, RBAC middleware, API routes |
| `server/seed.ts` | Seed data for new tenants |
| `client/src/lib/auth-context.tsx` | React auth state management |
| `client/src/lib/tenant-context.tsx` | React tenant state management |
| `client/src/pages/login.tsx` | Login page with MFA flow |
