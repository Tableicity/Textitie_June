import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  tenantsTable,
  contactsTable,
  conversationsTable,
  messagesTable,
  migrationJobsTable,
  migrationRawDataTable,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { hydrateCustomersBatch } from "./migrationStore";
import { transformCustomersPage } from "./migrationTransform";
import type { NormalizedContact } from "./migrationTransform";

// DB-backed tests for the TextLine Smasher address-book (customers) import: the
// pure page transform and the lease-fenced hydrateCustomersBatch. They run
// against the real test DB and mock nothing — the point is to prove the SQL
// safety invariants for STANDALONE contacts (address-book entries with no
// conversation history):
//   - a no-phone record is counted by verify but skipped by hydrate (phone is
//     NOT NULL);
//   - a phone already owned by a LIVE contact is linked, never re-quarantined;
//   - a phone already staged as a quarantined contact (by conversation hydrate
//     or a prior customers run) is MERGED non-destructively (COALESCE name/email,
//     UNION tags), never duplicated;
//   - the whole batch is idempotent across a re-run (fixed point);
//   - a stale lease token writes nothing.
// Each test gets its own throwaway tenant so the per-tenant unique indexes never
// collide across tests, and cleanup is a simple per-tenant cascade.

const RUN = `mig-customers-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const createdTenants: number[] = [];
let phoneSeq = 0;

function uniquePhone(): string {
  phoneSeq += 1;
  return `+1700${String(Date.now()).slice(-6)}${String(phoneSeq).padStart(2, "0")}`;
}

async function makeTenant(): Promise<number> {
  const slug = `${RUN}-${createdTenants.length}`;
  const [row] = await db
    .insert(tenantsTable)
    .values({
      slug,
      name: `Migration customers ${slug}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: uniquePhone(),
      engagementMode: "manual",
    })
    .returning({ id: tenantsTable.id });
  createdTenants.push(row.id);
  return row.id;
}

async function makeJob(
  tenantId: number,
  opts: { status: string; leaseToken?: string | null; pageCursor?: number },
): Promise<number> {
  const [row] = await db
    .insert(migrationJobsTable)
    .values({
      tenantId,
      source: "textline",
      status: opts.status,
      leaseToken: opts.leaseToken ?? null,
      leasedUntil: opts.leaseToken ? new Date(Date.now() + 60_000) : null,
      pageCursor: opts.pageCursor ?? 0,
    })
    .returning({ id: migrationJobsTable.id });
  return row.id;
}

function ncontact(
  overrides: Partial<NormalizedContact> & { phone: string | null },
): NormalizedContact {
  return {
    externalId: null,
    name: null,
    email: null,
    tags: [],
    anomalies: [],
    ...overrides,
  };
}

async function contactsForJob(jobId: number) {
  return db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.migrationJobId, jobId));
}

async function contactByPhone(tenantId: number, phone: string) {
  const [row] = await db
    .select()
    .from(contactsTable)
    .where(
      sql`${contactsTable.tenantId} = ${tenantId} AND ${contactsTable.phone} = ${phone}`,
    )
    .limit(1);
  return row ?? null;
}

async function jobRow(jobId: number) {
  const [row] = await db
    .select()
    .from(migrationJobsTable)
    .where(eq(migrationJobsTable.id, jobId))
    .limit(1);
  return row ?? null;
}

beforeAll(async () => {
  await db.execute(sql`SELECT 1`);
});

afterAll(async () => {
  for (const tenantId of createdTenants) {
    const convs = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(eq(conversationsTable.tenantId, tenantId));
    const convIds = convs.map((c) => c.id);
    if (convIds.length) {
      await db
        .delete(messagesTable)
        .where(inArray(messagesTable.conversationId, convIds));
    }
    await db
      .delete(conversationsTable)
      .where(eq(conversationsTable.tenantId, tenantId));
    await db.delete(contactsTable).where(eq(contactsTable.tenantId, tenantId));
    await db
      .delete(migrationRawDataTable)
      .where(eq(migrationRawDataTable.tenantId, tenantId));
    await db
      .delete(migrationJobsTable)
      .where(eq(migrationJobsTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  }
});

describe("transformCustomersPage — pure wire-shape extraction", () => {
  it("extracts contacts from the `customers` array with phone/name/email/tags", () => {
    const out = transformCustomersPage({
      customers: [
        {
          id: "cust-1",
          phone_number: "+17005550101",
          name: "Ada Lovelace",
          email: "ada@example.com",
          tags: ["vip", "beta"],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      externalId: "cust-1",
      phone: "+17005550101",
      name: "Ada Lovelace",
      email: "ada@example.com",
      tags: ["vip", "beta"],
    });
    expect(out[0].anomalies).toHaveLength(0);
  });

  it("reads the alternate `address_book` / `people` envelope keys", () => {
    expect(
      transformCustomersPage({ address_book: [{ phone: "+17005550102" }] }),
    ).toHaveLength(1);
    expect(
      transformCustomersPage({ people: [{ msisdn: "+17005550103" }] }),
    ).toHaveLength(1);
  });

  it("emits a no-phone record carrying a customer_missing_phone anomaly (no PII)", () => {
    const out = transformCustomersPage({
      contacts: [{ id: "no-phone-1", name: "Phoneless" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].phone).toBeNull();
    expect(out[0].anomalies).toHaveLength(1);
    expect(out[0].anomalies[0].type).toBe("customer_missing_phone");
    expect(out[0].anomalies[0].ref).toBe("no-phone-1");
    // The anomaly detail must not leak the contact's name/identity.
    expect(out[0].anomalies[0].detail).not.toContain("Phoneless");
  });

  it("never throws on garbage payloads — returns an empty array", () => {
    expect(transformCustomersPage(null)).toEqual([]);
    expect(transformCustomersPage(42)).toEqual([]);
    expect(transformCustomersPage({ customers: "not-an-array" })).toEqual([]);
    expect(transformCustomersPage({ customers: [null, 7, "x"] })).toEqual([]);
  });
});

describe("hydrateCustomersBatch — standalone insert + skip", () => {
  it("inserts a standalone contact as quarantined and skips a no-phone record", async () => {
    const tenantId = await makeTenant();
    const token = randomUUID();
    const jobId = await makeJob(tenantId, { status: "hydrating", leaseToken: token });
    const phone = uniquePhone();

    const { held, stats } = await hydrateCustomersBatch({
      tenantId,
      jobId,
      leaseToken: token,
      newCursor: 1,
      leaseMs: 60_000,
      contacts: [
        ncontact({ phone, name: "Grace", email: "grace@example.com", tags: ["vip"] }),
        ncontact({ phone: null, name: "Phoneless" }),
      ],
    });

    expect(held).toBe(true);
    expect(stats.contactsCreated).toBe(1);
    expect(stats.skippedNoPhone).toBe(1);

    const contacts = await contactsForJob(jobId);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].isQuarantined).toBe(true);
    expect(contacts[0].importExternalId).toBe(`phone:${phone}`);
    expect(contacts[0].name).toBe("Grace");
    expect(contacts[0].tags).toEqual(["vip"]);

    // Cursor advanced inside the txn.
    expect((await jobRow(jobId))?.pageCursor).toBe(1);
  });
});

describe("hydrateCustomersBatch — live collision is linked, never duplicated", () => {
  it("links to an existing LIVE contact instead of creating a quarantined dup", async () => {
    const tenantId = await makeTenant();
    const token = randomUUID();
    const jobId = await makeJob(tenantId, { status: "hydrating", leaseToken: token });
    const phone = uniquePhone();

    await db
      .insert(contactsTable)
      .values({ tenantId, phone, name: "Live", isQuarantined: false });

    const { stats } = await hydrateCustomersBatch({
      tenantId,
      jobId,
      leaseToken: token,
      newCursor: 1,
      leaseMs: 60_000,
      contacts: [ncontact({ phone, name: "Imported alias", tags: ["beta"] })],
    });

    expect(stats.contactsLinkedLive).toBe(1);
    expect(stats.contactsCreated).toBe(0);
    // No quarantined contact created for this job.
    expect(await contactsForJob(jobId)).toHaveLength(0);
    // The live contact is untouched (no quarantine flip, no tag pollution).
    const live = await contactByPhone(tenantId, phone);
    expect(live?.isQuarantined).toBe(false);
    expect(live?.tags).toBeNull();
  });
});

describe("hydrateCustomersBatch — merge into an existing quarantined contact", () => {
  it("non-destructively COALESCEs name/email and UNIONs tags from a prior hydrate", async () => {
    const tenantId = await makeTenant();
    const token = randomUUID();
    const jobId = await makeJob(tenantId, { status: "hydrating", leaseToken: token });
    const phone = uniquePhone();

    // Simulate a contact already created by conversation hydrate: it has a name
    // but no email and one tag, keyed by the shared phone:<phone> import id.
    await db.insert(contactsTable).values({
      tenantId,
      phone,
      name: "Existing Name",
      tags: ["existing"],
      isQuarantined: true,
      migrationJobId: jobId,
      importExternalId: `phone:${phone}`,
    });

    const { stats } = await hydrateCustomersBatch({
      tenantId,
      jobId,
      leaseToken: token,
      newCursor: 1,
      leaseMs: 60_000,
      contacts: [
        ncontact({
          phone,
          name: "From Address Book",
          email: "frombook@example.com",
          tags: ["existing", "fresh"],
        }),
      ],
    });

    expect(stats.contactsMerged).toBe(1);
    expect(stats.contactsCreated).toBe(0);

    const merged = await contactByPhone(tenantId, phone);
    // name is kept (COALESCE keeps the existing non-null value)...
    expect(merged?.name).toBe("Existing Name");
    // ...email is filled in (was null)...
    expect(merged?.email).toBe("frombook@example.com");
    // ...and tags are the de-duplicated union.
    expect(new Set(merged?.tags ?? [])).toEqual(new Set(["existing", "fresh"]));
    // Still exactly one row for the phone.
    expect(await contactsForJob(jobId)).toHaveLength(1);
  });

  it("leaves an existing NULL tags column alone when the address book is tagless", async () => {
    const tenantId = await makeTenant();
    const token = randomUUID();
    const jobId = await makeJob(tenantId, { status: "hydrating", leaseToken: token });
    const phone = uniquePhone();

    await db.insert(contactsTable).values({
      tenantId,
      phone,
      isQuarantined: true,
      migrationJobId: jobId,
      importExternalId: `phone:${phone}`,
    });

    await hydrateCustomersBatch({
      tenantId,
      jobId,
      leaseToken: token,
      newCursor: 1,
      leaseMs: 60_000,
      contacts: [ncontact({ phone, name: "Named Now", tags: [] })],
    });

    const merged = await contactByPhone(tenantId, phone);
    expect(merged?.name).toBe("Named Now");
    // The NULL-when-empty convention is preserved (never clobbered to []).
    expect(merged?.tags).toBeNull();
  });
});

describe("hydrateCustomersBatch — idempotent re-run", () => {
  it("re-running the identical batch reaches a fixed point (no dup rows)", async () => {
    const tenantId = await makeTenant();
    const token = randomUUID();
    const jobId = await makeJob(tenantId, { status: "hydrating", leaseToken: token });
    const phone = uniquePhone();
    const batch = {
      tenantId,
      jobId,
      leaseToken: token,
      newCursor: 1,
      leaseMs: 60_000,
      contacts: [ncontact({ phone, name: "Idem", email: "idem@example.com", tags: ["x"] })],
    };

    const r1 = await hydrateCustomersBatch(batch);
    expect(r1.stats.contactsCreated).toBe(1);
    const r2 = await hydrateCustomersBatch(batch);
    expect(r2.held).toBe(true);
    // Second pass merges into the row it created — it does not insert again.
    expect(r2.stats.contactsCreated).toBe(0);
    expect(r2.stats.contactsMerged).toBe(1);

    const contacts = await contactsForJob(jobId);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Idem");
    expect(contacts[0].tags).toEqual(["x"]);
  });
});

describe("hydrateCustomersBatch — lease fence", () => {
  it("writes nothing when the lease token no longer matches", async () => {
    const tenantId = await makeTenant();
    const token = randomUUID();
    const jobId = await makeJob(tenantId, { status: "hydrating", leaseToken: token });

    const { held, stats } = await hydrateCustomersBatch({
      tenantId,
      jobId,
      leaseToken: "not-the-token",
      newCursor: 1,
      leaseMs: 60_000,
      contacts: [ncontact({ phone: uniquePhone(), name: "Nope" })],
    });

    expect(held).toBe(false);
    expect(stats.contactsCreated).toBe(0);
    expect(await contactsForJob(jobId)).toHaveLength(0);
    // Cursor untouched.
    expect((await jobRow(jobId))?.pageCursor).toBe(0);
  });
});
