import { db, getTenantDb, tenantsTable, optInsTable, optOutsTable, messagesTable, conversationsTable, contactsTable } from "@workspace/db";
import { and, eq, gte, isNull, sql } from "drizzle-orm";

export type ComplianceBlock =
  | { ok: true }
  | { ok: false; reason: "blocked"; message: string }
  | { ok: false; reason: "opted_out"; message: string }
  | { ok: false; reason: "no_consent"; message: string }
  | { ok: false; reason: "quiet_hours"; message: string }
  | { ok: false; reason: "frequency_cap"; message: string };

interface TenantCompliance {
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  quietHoursTz: string;
  frequencyCapPerDay: number;
  requireDoubleOptIn: boolean;
}

async function loadTenantCompliance(tenantId: number): Promise<TenantCompliance | null> {
  const rows = await db
    .select({
      quietHoursStart: tenantsTable.quietHoursStart,
      quietHoursEnd: tenantsTable.quietHoursEnd,
      quietHoursTz: tenantsTable.quietHoursTz,
      frequencyCapPerDay: tenantsTable.frequencyCapPerDay,
      requireDoubleOptIn: tenantsTable.requireDoubleOptIn,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

export function isInQuietHours(
  start: number | null,
  end: number | null,
  tz: string,
  now: Date = new Date(),
): boolean {
  if (start == null || end == null || start === end) return false;
  let hour: number;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    hour = Number(fmt.format(now));
    if (Number.isNaN(hour)) hour = now.getUTCHours();
  } catch {
    hour = now.getUTCHours();
  }
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

async function isOptedOut(tenantSlug: string, tenantId: number, phone: string): Promise<boolean> {
  const tdb = getTenantDb(tenantSlug);
  const rows = await tdb
    .select({ id: optOutsTable.id })
    .from(optOutsTable)
    .where(and(eq(optOutsTable.tenantId, tenantId), eq(optOutsTable.phoneNumber, phone)))
    .limit(1);
  return rows.length > 0;
}

export async function isBlocked(tenantSlug: string, tenantId: number, phone: string): Promise<boolean> {
  const tdb = getTenantDb(tenantSlug);
  const rows = await tdb
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.tenantId, tenantId),
        eq(contactsTable.phone, phone),
        eq(contactsTable.blocked, true),
        eq(contactsTable.isQuarantined, false),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function hasConsent(tenantSlug: string, tenantId: number, phone: string): Promise<boolean> {
  const tdb = getTenantDb(tenantSlug);
  const rows = await tdb
    .select({ id: optInsTable.id })
    .from(optInsTable)
    .where(
      and(
        eq(optInsTable.tenantId, tenantId),
        eq(optInsTable.phone, phone),
        isNull(optInsTable.revokedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function countOutboundLast24h(tenantSlug: string, tenantId: number, phone: string): Promise<number> {
  const tdb = getTenantDb(tenantSlug);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await tdb
    .select({ c: sql<number>`count(*)::int` })
    .from(messagesTable)
    .innerJoin(conversationsTable, eq(messagesTable.conversationId, conversationsTable.id))
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.contactPhone, phone),
        eq(conversationsTable.isQuarantined, false),
        eq(messagesTable.isQuarantined, false),
        eq(messagesTable.direction, "outbound"),
        gte(messagesTable.createdAt, since),
      ),
    );
  return rows[0]?.c ?? 0;
}

export async function checkOutboundCompliance(
  tenantId: number,
  tenantSlug: string,
  phone: string,
  now: Date = new Date(),
): Promise<ComplianceBlock> {
  const t = await loadTenantCompliance(tenantId);
  if (!t) return { ok: true };

  if (await isBlocked(tenantSlug, tenantId, phone)) {
    return { ok: false, reason: "blocked", message: "Recipient is blocked." };
  }

  if (await isOptedOut(tenantSlug, tenantId, phone)) {
    return { ok: false, reason: "opted_out", message: "Recipient has opted out (STOP)." };
  }

  if (t.requireDoubleOptIn && !(await hasConsent(tenantSlug, tenantId, phone))) {
    return {
      ok: false,
      reason: "no_consent",
      message: "Recipient has no recorded opt-in consent and tenant requires double opt-in.",
    };
  }

  if (isInQuietHours(t.quietHoursStart, t.quietHoursEnd, t.quietHoursTz, now)) {
    return {
      ok: false,
      reason: "quiet_hours",
      message: `Outbound blocked: tenant quiet hours (${String(t.quietHoursStart).padStart(2, "0")}:00–${String(t.quietHoursEnd).padStart(2, "0")}:00 ${t.quietHoursTz}).`,
    };
  }

  if (t.frequencyCapPerDay > 0) {
    const sent = await countOutboundLast24h(tenantSlug, tenantId, phone);
    if (sent >= t.frequencyCapPerDay) {
      return {
        ok: false,
        reason: "frequency_cap",
        message: `Frequency cap reached: ${sent}/${t.frequencyCapPerDay} outbound to this number in the last 24h.`,
      };
    }
  }

  return { ok: true };
}
