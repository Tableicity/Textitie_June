import {
  db,
  phoneNumbersTable,
  tenantsTable,
  departmentsTable,
} from "@workspace/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * The ONLY place phone-number ownership is written. Inbound routing
 * (tenantPhoneLookup) and outbound ownership (outboundFrom) read the canonical
 * `phone_numbers` table this module maintains; every assign/clear path must go
 * through here so the denormalized `tenants.phone_number` /
 * `departments.phone_number` columns stay in lockstep and cross-tenant
 * conflicts are rejected (fail closed), not silently resolved to "the first
 * tenant". See John/architecture.doc.md Part 5.
 *
 * NOTE: `phone_numbers` is a GLOBAL (public-schema) table. These functions use
 * the shared `db`, which today routes to the global pool. If schema-per-tenant
 * isolation is ever re-enabled, this module must be pinned to the global pool
 * (see replit.md Stage 4 re-enablement checklist) — phone routing is global.
 */

export class PhoneNumberConflictError extends Error {
  readonly code = "phone_number_conflict";
  constructor(
    public readonly phoneNumber: string,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = "PhoneNumberConflictError";
  }
}

export class PhoneNumberValidationError extends Error {
  readonly code = "phone_number_invalid";
  constructor(public readonly input: string) {
    super(`"${input}" is not a valid E.164 phone number.`);
    this.name = "PhoneNumberValidationError";
  }
}

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Normalize a raw number to canonical E.164 (matches how existing data is
 * stored). Strips spaces/dashes/parens, infers a US country code for bare
 * 10/11-digit US numbers, and otherwise requires an explicit `+`. Returns null
 * for empty input; throws PhoneNumberValidationError for non-empty garbage so
 * bad data fails loud instead of being stored unrouted.
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  let cleaned = trimmed.replace(/[\s()\-.]/g, "");
  if (!cleaned.startsWith("+")) {
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length === 10) cleaned = `+1${digits}`;
    else if (digits.length === 11 && digits.startsWith("1")) cleaned = `+${digits}`;
    else cleaned = `+${digits}`;
  }
  if (!E164.test(cleaned)) throw new PhoneNumberValidationError(trimmed);
  return cleaned;
}

// NANP toll-free Service Access Codes (active + reserved-for-toll-free range).
// A number is the source of truth for its own type, so carrier billing can't be
// bypassed by a mislabeled client request.
const TOLL_FREE_NPA = new Set([
  "800", "822", "833", "844", "855", "866", "877",
  "880", "881", "882", "883", "884", "885", "886", "887", "888",
]);

/**
 * Classify a canonical E.164 number as 'toll_free' or 'local' from its prefix.
 * Only NANP (+1) numbers can be toll-free; everything else is treated as local
 * (the platform is US/CA-focused). This is the authoritative source for carrier
 * billing — local numbers incur the carrier fee + surcharge, toll-free do not.
 */
export function classifyNumberType(e164: string): "local" | "toll_free" {
  const m = /^\+1(\d{3})\d{7}$/.exec(e164);
  if (m && TOLL_FREE_NPA.has(m[1]!)) return "toll_free";
  return "local";
}

type CanonicalRow = typeof phoneNumbersTable.$inferSelect;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function canonicalByNumber(
  tx: Tx,
  phoneNumber: string,
): Promise<CanonicalRow | undefined> {
  const [row] = await tx
    .select()
    .from(phoneNumbersTable)
    .where(eq(phoneNumbersTable.phoneNumber, phoneNumber));
  return row;
}

/**
 * Set (or clear, with `rawNumber = null`) a tenant's PRIMARY number. Rejects if
 * the number already belongs to another tenant, or to one of this tenant's
 * departments. Removes the tenant's previous primary canonical row when the
 * number changes, and keeps `tenants.phone_number` in sync — all in one
 * transaction.
 */
export async function setTenantPrimaryNumber(
  tenantId: number,
  rawNumber: string | null,
): Promise<{ phoneNumber: string | null }> {
  const norm = normalizePhoneE164(rawNumber);

  return db.transaction(async (tx) => {
    const [currentPrimary] = await tx
      .select()
      .from(phoneNumbersTable)
      .where(
        and(
          eq(phoneNumbersTable.tenantId, tenantId),
          eq(phoneNumbersTable.kind, "primary"),
        ),
      );

    if (norm == null) {
      if (currentPrimary) {
        await tx
          .delete(phoneNumbersTable)
          .where(eq(phoneNumbersTable.phoneNumber, currentPrimary.phoneNumber));
      }
      await tx
        .update(tenantsTable)
        .set({ phoneNumber: null })
        .where(eq(tenantsTable.id, tenantId));
      return { phoneNumber: null };
    }

    const existing = await canonicalByNumber(tx, norm);
    if (existing) {
      if (existing.tenantId !== tenantId) {
        throw new PhoneNumberConflictError(
          norm,
          "This number is already assigned to another account.",
        );
      }
      if (existing.departmentId != null) {
        throw new PhoneNumberConflictError(
          norm,
          "This number is assigned to a department; unassign it from the department first.",
        );
      }
    }

    if (currentPrimary && currentPrimary.phoneNumber !== norm) {
      await tx
        .delete(phoneNumbersTable)
        .where(eq(phoneNumbersTable.phoneNumber, currentPrimary.phoneNumber));
    }

    const claimed = await tx
      .insert(phoneNumbersTable)
      .values({
        phoneNumber: norm,
        tenantId,
        departmentId: null,
        kind: "primary",
        numberType: classifyNumberType(norm),
      })
      .onConflictDoUpdate({
        target: phoneNumbersTable.phoneNumber,
        set: {
          tenantId,
          departmentId: null,
          kind: "primary",
          numberType: classifyNumberType(norm),
        },
        // Race guard: only adopt an existing row if it is ALREADY this tenant's
        // own primary. If a concurrent writer claimed this number first, the
        // WHERE is false, no row is updated/returned, and we fail closed instead
        // of silently stealing it (the pre-check above has a TOCTOU window).
        where: and(
          eq(phoneNumbersTable.tenantId, tenantId),
          isNull(phoneNumbersTable.departmentId),
        ),
      })
      .returning({ phoneNumber: phoneNumbersTable.phoneNumber });
    if (claimed.length === 0) {
      throw new PhoneNumberConflictError(
        norm,
        "This number is already assigned to another account.",
      );
    }

    await tx
      .update(tenantsTable)
      .set({ phoneNumber: norm })
      .where(eq(tenantsTable.id, tenantId));

    return { phoneNumber: norm };
  });
}

/**
 * Set (or clear, with `rawNumber = null`) a department's number. Rejects if the
 * number belongs to another tenant, to this tenant's primary, or to a different
 * department. Keeps `departments.phone_number` / `twilio_sid` in sync.
 *
 * `opts.allowReclaimFromOwnPrimary` (admin/Conductor only): when the number is
 * THIS tenant's own primary, instead of rejecting, free it from primary
 * (`tenants.phone_number = null` + drop the primary canonical row) IN THE SAME
 * transaction and re-claim it as the department's number. The primary↔department
 * XOR invariant is therefore never even momentarily violated. Tenant-app callers
 * leave this off and keep the helpful "unassign it from primary first" 409.
 */
export async function setDepartmentNumber(
  tenantId: number,
  departmentId: number,
  rawNumber: string | null,
  twilioSid: string | null = null,
  opts: { allowReclaimFromOwnPrimary?: boolean } = {},
): Promise<{ phoneNumber: string | null }> {
  const norm = normalizePhoneE164(rawNumber);

  return db.transaction(async (tx) => {
    const [currentDept] = await tx
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.departmentId, departmentId));

    if (norm == null) {
      if (currentDept) {
        await tx
          .delete(phoneNumbersTable)
          .where(eq(phoneNumbersTable.phoneNumber, currentDept.phoneNumber));
      }
      await tx
        .update(departmentsTable)
        .set({ phoneNumber: null, twilioSid: null })
        .where(eq(departmentsTable.id, departmentId));
      return { phoneNumber: null };
    }

    const existing = await canonicalByNumber(tx, norm);
    if (existing) {
      if (existing.tenantId !== tenantId) {
        throw new PhoneNumberConflictError(
          norm,
          "This number is already assigned to another account.",
        );
      }
      if (existing.departmentId == null) {
        if (!opts.allowReclaimFromOwnPrimary) {
          throw new PhoneNumberConflictError(
            norm,
            "This number is the account's primary number; it cannot also be a department number.",
          );
        }
        // Admin reclaim: `existing` is this tenant's own primary (cross-tenant
        // was already rejected above). Drop the primary canonical row and clear
        // the denormalized column so the subsequent claim is a clean insert and
        // the number holds exactly one role for the whole transaction.
        await tx
          .delete(phoneNumbersTable)
          .where(eq(phoneNumbersTable.phoneNumber, norm));
        await tx
          .update(tenantsTable)
          .set({ phoneNumber: null })
          .where(eq(tenantsTable.id, tenantId));
      } else if (existing.departmentId !== departmentId) {
        throw new PhoneNumberConflictError(
          norm,
          "This number is already assigned to another department.",
        );
      }
    }

    if (currentDept && currentDept.phoneNumber !== norm) {
      await tx
        .delete(phoneNumbersTable)
        .where(eq(phoneNumbersTable.phoneNumber, currentDept.phoneNumber));
    }

    const claimed = await tx
      .insert(phoneNumbersTable)
      .values({
        phoneNumber: norm,
        tenantId,
        departmentId,
        kind: "department",
        twilioSid,
        numberType: classifyNumberType(norm),
      })
      .onConflictDoUpdate({
        target: phoneNumbersTable.phoneNumber,
        set: {
          tenantId,
          departmentId,
          kind: "department",
          twilioSid,
          numberType: classifyNumberType(norm),
        },
        // Race guard: only adopt an existing row if it is ALREADY this exact
        // department's row. Otherwise fail closed instead of stealing a number a
        // concurrent writer claimed between the pre-check and this insert.
        where: and(
          eq(phoneNumbersTable.tenantId, tenantId),
          eq(phoneNumbersTable.departmentId, departmentId),
        ),
      })
      .returning({ phoneNumber: phoneNumbersTable.phoneNumber });
    if (claimed.length === 0) {
      throw new PhoneNumberConflictError(
        norm,
        "This number is already assigned to another account.",
      );
    }

    await tx
      .update(departmentsTable)
      .set({ phoneNumber: norm, twilioSid })
      .where(eq(departmentsTable.id, departmentId));

    return { phoneNumber: norm };
  });
}

/**
 * Idempotent DDL guaranteeing the canonical `phone_numbers` table (and its two
 * partial unique indexes) exist. Runs at boot BEFORE the backfill.
 *
 * Why this exists: the autoscale deploy build has NO migration step, and dev and
 * prod are SEPARATE databases, so a `drizzle push` from the workspace shell can
 * never reach prod. Creating the table here means a republish provisions it in
 * prod automatically; it is a no-op in dev (the table already exists). This is
 * also safer than running a full `drizzle push --force` against prod, which would
 * diff the ENTIRE schema. Mirrors lib/db/src/schema/phoneNumbers.ts exactly —
 * keep the two in lockstep.
 */
export async function ensurePhoneNumbersSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS phone_numbers (
      phone_number text PRIMARY KEY,
      tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      department_id integer REFERENCES departments(id) ON DELETE CASCADE,
      twilio_sid text,
      kind text NOT NULL DEFAULT 'primary',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS phone_numbers_one_primary_per_tenant
      ON phone_numbers (tenant_id) WHERE kind = 'primary'
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS phone_numbers_one_row_per_department
      ON phone_numbers (department_id) WHERE department_id IS NOT NULL
  `);
  logger.info("phone_numbers canonical table ensured (idempotent)");
}

/**
 * Idempotent boot-time backfill of the canonical table from the legacy
 * denormalized columns. A GLOBAL table, so it is safe to run at startup (unlike
 * the Stage 4 per-tenant boot-seeding hazard). Numbers that map to more than one
 * tenant/department are logged LOUDLY and skipped — never silently resolved.
 */
export async function backfillPhoneNumbers(): Promise<{
  inserted: number;
  alreadyPresent: number;
  conflicts: number;
  reclassified: number;
}> {
  type Candidate = {
    phoneNumber: string;
    tenantId: number;
    departmentId: number | null;
    twilioSid: string | null;
    kind: "primary" | "department";
    source: string;
  };

  const candidates: Candidate[] = [];

  const tenants = await db
    .select({ id: tenantsTable.id, phoneNumber: tenantsTable.phoneNumber })
    .from(tenantsTable)
    .where(isNotNull(tenantsTable.phoneNumber));
  for (const t of tenants) {
    try {
      const norm = normalizePhoneE164(t.phoneNumber);
      if (norm) {
        candidates.push({
          phoneNumber: norm,
          tenantId: t.id,
          departmentId: null,
          twilioSid: null,
          kind: "primary",
          source: `tenant:${t.id}`,
        });
      }
    } catch {
      logger.error(
        { tenantId: t.id, raw: t.phoneNumber },
        "phone backfill: tenant primary is not valid E.164, skipping",
      );
    }
  }

  const depts = await db
    .select({
      id: departmentsTable.id,
      tenantId: departmentsTable.tenantId,
      phoneNumber: departmentsTable.phoneNumber,
      twilioSid: departmentsTable.twilioSid,
    })
    .from(departmentsTable)
    .where(isNotNull(departmentsTable.phoneNumber));
  for (const d of depts) {
    try {
      const norm = normalizePhoneE164(d.phoneNumber);
      if (norm) {
        candidates.push({
          phoneNumber: norm,
          tenantId: d.tenantId,
          departmentId: d.id,
          twilioSid: d.twilioSid,
          kind: "department",
          source: `department:${d.id}`,
        });
      }
    } catch {
      logger.error(
        { departmentId: d.id, raw: d.phoneNumber },
        "phone backfill: department number is not valid E.164, skipping",
      );
    }
  }

  const byNumber = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = byNumber.get(c.phoneNumber) ?? [];
    list.push(c);
    byNumber.set(c.phoneNumber, list);
  }

  let inserted = 0;
  let alreadyPresent = 0;
  let conflicts = 0;

  for (const [phoneNumber, owners] of byNumber) {
    const distinct = new Set(
      owners.map((o) => `${o.tenantId}:${o.departmentId ?? "primary"}`),
    );
    if (distinct.size > 1) {
      conflicts += 1;
      logger.error(
        { phoneNumber, owners: owners.map((o) => o.source) },
        "phone backfill: number maps to multiple owners — NOT migrated, resolve manually",
      );
      continue;
    }

    const existing = await db
      .select({ phoneNumber: phoneNumbersTable.phoneNumber })
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.phoneNumber, phoneNumber));
    if (existing.length > 0) {
      alreadyPresent += 1;
      continue;
    }

    const c = owners[0];
    await db.insert(phoneNumbersTable).values({
      phoneNumber: c.phoneNumber,
      tenantId: c.tenantId,
      departmentId: c.departmentId,
      twilioSid: c.twilioSid,
      kind: c.kind,
      numberType: classifyNumberType(c.phoneNumber),
    });
    inserted += 1;
  }

  // Self-heal number_type for EVERY canonical row from the number itself. The
  // column defaults to 'local', so any row that pre-dates classification — or a
  // toll-free number inserted before this code shipped — would be mis-billed as
  // local (carrier fee + surcharge instead of $0). The E.164 number is the
  // source of truth, so recompute and correct drift on every boot. Idempotent:
  // no writes once all rows are correct.
  const reclassifyRows = await db
    .select({
      phoneNumber: phoneNumbersTable.phoneNumber,
      numberType: phoneNumbersTable.numberType,
    })
    .from(phoneNumbersTable);
  let reclassified = 0;
  for (const row of reclassifyRows) {
    const correct = classifyNumberType(row.phoneNumber);
    if (row.numberType !== correct) {
      await db
        .update(phoneNumbersTable)
        .set({ numberType: correct })
        .where(eq(phoneNumbersTable.phoneNumber, row.phoneNumber));
      reclassified += 1;
    }
  }
  if (reclassified > 0) {
    logger.warn(
      { reclassified },
      "phone backfill: corrected number_type drift from canonical numbers",
    );
  }

  logger.info(
    { inserted, alreadyPresent, conflicts, reclassified },
    "phone backfill complete",
  );
  return { inserted, alreadyPresent, conflicts, reclassified };
}

/**
 * Compares the canonical table against the denormalized columns and returns any
 * mismatches. Intended for a boot-time / health-check drift detector so the
 * two-sources-of-truth disease that caused the leak is caught loudly.
 */
export async function detectPhoneNumberDrift(): Promise<string[]> {
  const issues: string[] = [];
  const tryNorm = (raw: string | null): string | null => {
    try {
      return normalizePhoneE164(raw);
    } catch {
      return null;
    }
  };

  // Load everything once, compare in memory (both directions).
  const canonical = await db.select().from(phoneNumbersTable);
  const tenants = await db
    .select({ id: tenantsTable.id, phoneNumber: tenantsTable.phoneNumber })
    .from(tenantsTable);
  const depts = await db
    .select({
      id: departmentsTable.id,
      tenantId: departmentsTable.tenantId,
      phoneNumber: departmentsTable.phoneNumber,
    })
    .from(departmentsTable);

  const canonByNumber = new Map<string, CanonicalRow>();
  const primaryCountByTenant = new Map<number, number>();
  const rowCountByDept = new Map<number, number>();
  for (const row of canonical) {
    canonByNumber.set(row.phoneNumber, row);
    // kind <-> department_id consistency.
    if (row.departmentId == null && row.kind !== "primary") {
      issues.push(
        `canonical ${row.phoneNumber} has no department but kind='${row.kind}'`,
      );
    }
    if (row.departmentId != null && row.kind !== "department") {
      issues.push(
        `canonical ${row.phoneNumber} has a department but kind='${row.kind}'`,
      );
    }
    if (row.kind === "primary") {
      primaryCountByTenant.set(
        row.tenantId,
        (primaryCountByTenant.get(row.tenantId) ?? 0) + 1,
      );
    }
    if (row.departmentId != null) {
      rowCountByDept.set(
        row.departmentId,
        (rowCountByDept.get(row.departmentId) ?? 0) + 1,
      );
    }
  }
  for (const [tenantId, count] of primaryCountByTenant) {
    if (count > 1) {
      issues.push(
        `tenant ${tenantId} has ${count} primary canonical rows (expected 1)`,
      );
    }
  }
  for (const [departmentId, count] of rowCountByDept) {
    if (count > 1) {
      issues.push(
        `department ${departmentId} has ${count} canonical rows (expected 1)`,
      );
    }
  }

  // Forward: every denorm number must have a matching canonical row.
  const tenantNorm = new Map<number, string | null>();
  for (const t of tenants) {
    const norm = tryNorm(t.phoneNumber);
    tenantNorm.set(t.id, norm);
    if (!norm) continue;
    const canon = canonByNumber.get(norm);
    if (!canon) {
      issues.push(`tenant ${t.id} primary ${norm} missing from phone_numbers`);
    } else if (
      canon.tenantId !== t.id ||
      canon.kind !== "primary" ||
      canon.departmentId != null
    ) {
      issues.push(
        `tenant ${t.id} primary ${norm} canonical row mismatched (tenant ${canon.tenantId}, kind ${canon.kind}, dept ${canon.departmentId})`,
      );
    }
  }

  const deptInfo = new Map<number, { tenantId: number; norm: string | null }>();
  for (const d of depts) {
    const norm = tryNorm(d.phoneNumber);
    deptInfo.set(d.id, { tenantId: d.tenantId, norm });
    if (!norm) continue;
    const canon = canonByNumber.get(norm);
    if (!canon) {
      issues.push(`department ${d.id} number ${norm} missing from phone_numbers`);
    } else if (canon.tenantId !== d.tenantId || canon.departmentId !== d.id) {
      issues.push(
        `department ${d.id} number ${norm} canonical row points elsewhere (tenant ${canon.tenantId}, dept ${canon.departmentId})`,
      );
    }
  }

  // Reverse: every canonical row must be reflected in the denorm columns, or it
  // is a stale/orphan row that would still route inbound to a number nobody owns.
  for (const row of canonical) {
    if (row.kind === "primary") {
      const norm = tenantNorm.get(row.tenantId);
      if (norm !== row.phoneNumber) {
        issues.push(
          `canonical primary ${row.phoneNumber} (tenant ${row.tenantId}) not reflected in tenants.phone_number (${norm ?? "null"})`,
        );
      }
    } else if (row.departmentId != null) {
      const info = deptInfo.get(row.departmentId);
      if (!info) {
        issues.push(
          `canonical row ${row.phoneNumber} references missing department ${row.departmentId}`,
        );
      } else if (info.norm !== row.phoneNumber || info.tenantId !== row.tenantId) {
        issues.push(
          `canonical department ${row.departmentId} (${row.phoneNumber}) not reflected in departments (number ${info.norm ?? "null"}, tenant ${info.tenantId})`,
        );
      }
    }
  }

  if (issues.length > 0) {
    logger.error({ issues }, "phone number drift detected");
  }
  return issues;
}
