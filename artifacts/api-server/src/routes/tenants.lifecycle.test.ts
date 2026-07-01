import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, tenantsTable, phoneNumbersTable } from "@workspace/db";
import { processTenantPurge, PURGE_WINDOW_MS } from "../lib/tenantLifecycle";
import { isTenantSendingExpired } from "../lib/demoTextingGate";

const { default: app } = await import("../app");

// Exercises the tenant-lifecycle feature against the real test DB: soft-archive /
// restore, the Conductor unassign-number route, the archived-tenant backend send
// gate, and the scheduled hard-purge (including its owns-numbers skip and the
// restore-vs-purge recheck that guards against the TOCTOU data-loss race).

const RUN = `tlife-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  return `+1995${String(Date.now()).slice(-6)}${phoneSeq}`;
}

const createdTenantIds: number[] = [];

function asConductor(req: request.Test): request.Test {
  const pw = process.env["CONDUCTOR_PASSWORD"];
  return pw ? req.auth("conductor", pw) : req;
}

async function makeTenant(
  suffix: string,
  overrides: Partial<typeof tenantsTable.$inferInsert> = {},
): Promise<number> {
  const [t] = await db
    .insert(tenantsTable)
    .values({
      slug: `${RUN}-${suffix}`,
      name: `Lifecycle ${suffix}`,
      region: "US",
      tierCode: "starter",
      ...overrides,
    })
    .returning({ id: tenantsTable.id });
  createdTenantIds.push(t.id);
  return t.id;
}

async function tenantRow(id: number) {
  const [row] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, id));
  return row ?? null;
}

afterAll(async () => {
  // FK-safe teardown for any tenant not already hard-deleted by the purge tests.
  for (const id of createdTenantIds) {
    try {
      await db.delete(phoneNumbersTable).where(eq(phoneNumbersTable.tenantId, id));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
    } catch {
      // ignore — the tenant may already be purged.
    }
  }
});

describe("tenant lifecycle: archive / restore", () => {
  it("archives a tenant (status + purgeAfter) and restores it (cleared)", async () => {
    const id = await makeTenant("ar");

    const before = Date.now();
    const arch = await asConductor(
      request(app).post(`/api/tenants/${id}/archive`),
    ).send({ reason: "test archive" });
    expect(arch.status).toBe(200);
    expect(arch.body.lifecycleStatus).toBe("archived");
    expect(arch.body.archiveReason).toBe("test archive");
    expect(arch.body.purgeAfter).toBeTruthy();

    const row = await tenantRow(id);
    expect(row?.lifecycleStatus).toBe("archived");
    expect(row?.archivedAt).toBeTruthy();
    // purgeAfter must be ~ now + PURGE_WINDOW_MS (allow generous slack).
    const purgeAt = new Date(row!.purgeAfter as unknown as string).getTime();
    expect(purgeAt).toBeGreaterThan(before + PURGE_WINDOW_MS - 60_000);

    const restore = await asConductor(
      request(app).post(`/api/tenants/${id}/restore`),
    ).send();
    expect(restore.status).toBe(200);
    expect(restore.body.lifecycleStatus).toBe("active");
    expect(restore.body.purgeAfter).toBeNull();

    const after = await tenantRow(id);
    expect(after?.lifecycleStatus).toBe("active");
    expect(after?.archivedAt).toBeNull();
    expect(after?.purgeAfter).toBeNull();
  });

  it("refuses to archive OR delete a protected seed tenant, without mutating it", async () => {
    // Reuse an existing 'acme' if the demo seed created one; otherwise create a
    // throwaway with the protected slug. Either way the guards return BEFORE any
    // mutation, so this never actually archives/deletes 'acme'.
    let acme = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, "acme"))
      .then((r) => r[0]);
    let temp = false;
    if (!acme) {
      const [t] = await db
        .insert(tenantsTable)
        .values({ slug: "acme", name: "Acme", region: "US", tierCode: "starter" })
        .returning({ id: tenantsTable.id });
      acme = t;
      temp = true;
    }

    try {
      const arch = await asConductor(
        request(app).post(`/api/tenants/${acme.id}/archive`),
      ).send({});
      expect(arch.status).toBe(400);

      const del = await asConductor(
        request(app).delete(`/api/tenants/${acme.id}`),
      ).send({ slug: "acme" });
      expect(del.status).toBe(403);

      const row = await tenantRow(acme.id);
      expect(row?.lifecycleStatus).toBe("active");
    } finally {
      if (temp) {
        await db.delete(tenantsTable).where(eq(tenantsTable.id, acme.id));
      }
    }
  });
});

describe("archived tenant backend send gate", () => {
  it("hard-stops backend sends for an archived tenant even with billingBypass", async () => {
    const id = await makeTenant("gate", {
      subscriptionStatus: "active",
      billingBypass: true,
    });

    // Active + bypass → sending allowed.
    expect(await isTenantSendingExpired(id)).toBe(false);

    await db
      .update(tenantsTable)
      .set({ lifecycleStatus: "archived" })
      .where(eq(tenantsTable.id, id));

    // Archived must hard-stop regardless of billingBypass.
    expect(await isTenantSendingExpired(id)).toBe(true);
  });
});

describe("Conductor unassign phone number (return to pool)", () => {
  it("404s a number not owned by the tenant", async () => {
    const id = await makeTenant("un404");
    const res = await asConductor(
      request(app).post(`/api/tenants/${id}/phone-numbers/unassign`),
    ).send({ phoneNumber: uniquePhone() });
    expect(res.status).toBe(404);
  });

  it("returns an owned primary number to the pool", async () => {
    const id = await makeTenant("unok");
    const phone = uniquePhone();
    await db
      .insert(phoneNumbersTable)
      .values({ phoneNumber: phone, tenantId: id, kind: "primary" });

    const res = await asConductor(
      request(app).post(`/api/tenants/${id}/phone-numbers/unassign`),
    ).send({ phoneNumber: phone });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const stillOwned = await db
      .select({ phoneNumber: phoneNumbersTable.phoneNumber })
      .from(phoneNumbersTable)
      .where(
        and(
          eq(phoneNumbersTable.phoneNumber, phone),
          eq(phoneNumbersTable.tenantId, id),
        ),
      );
    expect(stillOwned).toHaveLength(0);
  });
});

describe("scheduled tenant purge", () => {
  it("hard-deletes an archived, past-window tenant that owns no numbers", async () => {
    const id = await makeTenant("purge-ok", {
      lifecycleStatus: "archived",
      purgeAfter: new Date(Date.now() - 1000),
    });

    await processTenantPurge();

    expect(await tenantRow(id)).toBeNull();
  });

  it("does NOT purge an archived tenant whose window has not elapsed", async () => {
    const id = await makeTenant("purge-early", {
      lifecycleStatus: "archived",
      purgeAfter: new Date(Date.now() + 60 * 60 * 1000),
    });

    await processTenantPurge();

    expect(await tenantRow(id)).not.toBeNull();
  });

  it("does NOT purge a restored (active) tenant even with a past purgeAfter", async () => {
    // Mirrors the restore-vs-purge race outcome: a tenant that is no longer
    // 'archived' must survive even if a stale purge_after is still in the past.
    const id = await makeTenant("purge-restored", {
      lifecycleStatus: "active",
      purgeAfter: new Date(Date.now() - 1000),
    });

    await processTenantPurge();

    const row = await tenantRow(id);
    expect(row).not.toBeNull();
    expect(row?.lifecycleStatus).toBe("active");
  });

  it("skips (with a blocked reason) an archived tenant that still owns a number, then purges it once returned", async () => {
    const id = await makeTenant("purge-owns", {
      lifecycleStatus: "archived",
      purgeAfter: new Date(Date.now() - 1000),
    });
    const phone = uniquePhone();
    await db
      .insert(phoneNumbersTable)
      .values({ phoneNumber: phone, tenantId: id, kind: "primary" });

    await processTenantPurge();

    const blocked = await tenantRow(id);
    expect(blocked).not.toBeNull();
    expect(blocked?.purgeBlockedReason).toBeTruthy();

    // Return the number to the pool, then the next cycle may purge.
    await db.delete(phoneNumbersTable).where(eq(phoneNumbersTable.tenantId, id));
    await processTenantPurge();

    expect(await tenantRow(id)).toBeNull();
  });
});
