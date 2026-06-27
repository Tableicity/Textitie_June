import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
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
import { hydrateConversationBatch } from "./migrationStore";
import {
  transitionToHydrating,
  flipMigrationLive,
  discardMigration,
} from "./migrationActions";
import type { NormalizedConversation } from "./migrationTransform";

// DB-backed tests for the TextLine Smasher Phase-3 hydrate batch + the operator
// actions (hydrate gate / flip-live / discard). They run against the real test
// DB and mock nothing — the whole point is to prove the SQL safety invariants:
//   - hydrate dedupes contacts by phone, links to a live contact, and re-runs
//     idempotently;
//   - discard deletes ONLY quarantined rows, never live data;
//   - flip merges a quarantined contact into a live one, clears quarantine, is
//     idempotent, and fails CLOSED (collision) rather than corrupting the live
//     unique index.
// Each test gets its own throwaway tenant so the per-tenant "one active job"
// partial unique index and the (tenant,phone) live-contact index never collide
// across tests, and cleanup is a simple per-tenant cascade.

const RUN = `mig-actions-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
      name: `Migration actions ${slug}`,
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
  opts: {
    status: string;
    summary?: Record<string, unknown> | null;
    leaseToken?: string | null;
    pageCursor?: number;
  },
): Promise<number> {
  const [row] = await db
    .insert(migrationJobsTable)
    .values({
      tenantId,
      source: "textline",
      status: opts.status,
      summary: opts.summary ?? null,
      leaseToken: opts.leaseToken ?? null,
      leasedUntil: opts.leaseToken ? new Date(Date.now() + 60_000) : null,
      pageCursor: opts.pageCursor ?? 0,
    })
    .returning({ id: migrationJobsTable.id });
  return row.id;
}

function nconv(
  overrides: Partial<NormalizedConversation> & { importExternalId: string },
): NormalizedConversation {
  return {
    phone: null,
    contactName: null,
    contactEmail: null,
    contactTags: [],
    status: "closed",
    tags: [],
    lastMessageAt: null,
    createdAt: null,
    messages: [],
    skippedMms: 0,
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

async function conversationsForJob(jobId: number) {
  return db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.migrationJobId, jobId));
}

async function messagesForJob(jobId: number) {
  return db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.migrationJobId, jobId));
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
  // Touch the schema early so a connection/migration problem fails loudly here.
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

describe("hydrateConversationBatch — contact phone dedup", () => {
  it("collapses two conversations that share a phone onto one quarantined contact", async () => {
    const tenantId = await makeTenant();
    const token = randomUUID();
    const jobId = await makeJob(tenantId, { status: "hydrating", leaseToken: token });
    const phone = uniquePhone();

    const { held, stats } = await hydrateConversationBatch({
      tenantId,
      jobId,
      leaseToken: token,
      newCursor: 2,
      leaseMs: 60_000,
      conversations: [
        nconv({ importExternalId: "c1", phone, contactName: "Alpha" }),
        nconv({ importExternalId: "c2", phone, contactName: "Alpha alias" }),
      ],
    });

    expect(held).toBe(true);
    expect(stats.contactsCreated).toBe(1);
    expect(stats.conversationsUpserted).toBe(2);

    const contacts = await contactsForJob(jobId);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].isQuarantined).toBe(true);
    expect(contacts[0].importExternalId).toBe(`phone:${phone}`);

    const convs = await conversationsForJob(jobId);
    expect(convs).toHaveLength(2);
    expect(new Set(convs.map((c) => c.contactId))).toEqual(
      new Set([contacts[0].id]),
    );
    for (const c of convs) expect(c.isQuarantined).toBe(true);
  });

  it("links to an existing LIVE contact instead of creating a quarantined dup", async () => {
    const tenantId = await makeTenant();
    const token = randomUUID();
    const jobId = await makeJob(tenantId, { status: "hydrating", leaseToken: token });
    const phone = uniquePhone();

    const [live] = await db
      .insert(contactsTable)
      .values({ tenantId, phone, name: "Live", isQuarantined: false })
      .returning({ id: contactsTable.id });

    const { stats } = await hydrateConversationBatch({
      tenantId,
      jobId,
      leaseToken: token,
      newCursor: 1,
      leaseMs: 60_000,
      conversations: [nconv({ importExternalId: "c1", phone, contactName: "Imp" })],
    });

    expect(stats.contactsLinkedLive).toBe(1);
    expect(stats.contactsCreated).toBe(0);

    // No quarantined contact was created for this job.
    const quarantined = await contactsForJob(jobId);
    expect(quarantined).toHaveLength(0);

    const convs = await conversationsForJob(jobId);
    expect(convs).toHaveLength(1);
    expect(convs[0].contactId).toBe(live.id);
    expect(convs[0].isQuarantined).toBe(true);
  });
});

describe("hydrateConversationBatch — re-run idempotency", () => {
  it("re-running the identical batch inserts no duplicate rows", async () => {
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
      conversations: [
        nconv({
          importExternalId: "c1",
          phone,
          contactName: "Repeat",
          messages: [
            {
              importExternalId: "m1",
              direction: "inbound" as const,
              body: "hi",
              senderName: null,
              createdAt: null,
              deliveredAt: null,
            },
            {
              importExternalId: "m2",
              direction: "outbound" as const,
              body: "hello",
              senderName: "Agent",
              createdAt: null,
              deliveredAt: null,
            },
          ],
        }),
      ],
    };

    await hydrateConversationBatch(batch);
    const r2 = await hydrateConversationBatch({ ...batch, newCursor: 1 });
    expect(r2.held).toBe(true);

    expect(await contactsForJob(jobId)).toHaveLength(1);
    expect(await conversationsForJob(jobId)).toHaveLength(1);
    expect(await messagesForJob(jobId)).toHaveLength(2);
  });
});

describe("hydrateConversationBatch — lease fence", () => {
  it("writes nothing when the lease token no longer matches", async () => {
    const tenantId = await makeTenant();
    const token = randomUUID();
    const jobId = await makeJob(tenantId, { status: "hydrating", leaseToken: token });

    const { held, stats } = await hydrateConversationBatch({
      tenantId,
      jobId,
      leaseToken: "not-the-token",
      newCursor: 1,
      leaseMs: 60_000,
      conversations: [nconv({ importExternalId: "c1", phone: uniquePhone() })],
    });

    expect(held).toBe(false);
    expect(stats.conversationsUpserted).toBe(0);
    expect(await conversationsForJob(jobId)).toHaveLength(0);
  });
});

describe("transitionToHydrating — operator hydrate gate", () => {
  it("queues a job parked at review (cursor reset to 0)", async () => {
    const tenantId = await makeTenant();
    const jobId = await makeJob(tenantId, { status: "review", pageCursor: 9 });

    const res = await transitionToHydrating(tenantId, jobId);
    expect(res.status).toBe("queued");

    const row = await jobRow(jobId);
    expect(row?.status).toBe("hydrating");
    expect(row?.pageCursor).toBe(0);
  });

  it("is a benign no-op when already hydrating", async () => {
    const tenantId = await makeTenant();
    const jobId = await makeJob(tenantId, { status: "hydrating" });
    const res = await transitionToHydrating(tenantId, jobId);
    expect(res.status).toBe("already_queued");
  });

  it("refuses to queue a job that is not at review", async () => {
    const tenantId = await makeTenant();
    const jobId = await makeJob(tenantId, { status: "extracted" });
    const res = await transitionToHydrating(tenantId, jobId);
    expect(res).toEqual({ status: "not_ready", current: "extracted" });
  });
});

describe("discardMigration — never deletes live data", () => {
  it("deletes only quarantined imported rows and leaves live rows intact", async () => {
    const tenantId = await makeTenant();
    const jobId = await makeJob(tenantId, { status: "review" });
    const livePhone = uniquePhone();
    const importPhone = uniquePhone();

    // A pre-existing live contact + live conversation (NOT part of this import).
    const [liveContact] = await db
      .insert(contactsTable)
      .values({ tenantId, phone: livePhone, name: "Live", isQuarantined: false })
      .returning({ id: contactsTable.id });
    const [liveConv] = await db
      .insert(conversationsTable)
      .values({
        tenantId,
        contactId: liveContact.id,
        contactPhone: livePhone,
        isQuarantined: false,
      })
      .returning({ id: conversationsTable.id });
    await db
      .insert(messagesTable)
      .values({ conversationId: liveConv.id, direction: "inbound", body: "live msg" });

    // Quarantined imported rows for this job.
    const [qContact] = await db
      .insert(contactsTable)
      .values({
        tenantId,
        phone: importPhone,
        isQuarantined: true,
        migrationJobId: jobId,
        importExternalId: `phone:${importPhone}`,
      })
      .returning({ id: contactsTable.id });
    const [qConv] = await db
      .insert(conversationsTable)
      .values({
        tenantId,
        contactId: qContact.id,
        contactPhone: importPhone,
        isQuarantined: true,
        migrationJobId: jobId,
        importExternalId: "qc1",
      })
      .returning({ id: conversationsTable.id });
    await db.insert(messagesTable).values({
      conversationId: qConv.id,
      direction: "inbound",
      body: "imported",
      isQuarantined: true,
      migrationJobId: jobId,
      importExternalId: "qm1",
    });
    await db.insert(migrationRawDataTable).values({
      jobId,
      tenantId,
      entity: "conversation_posts",
      page: 0,
      recordKey: "conversation_posts:x1",
      payload: { foo: "bar" },
      recordCount: 1,
    });

    const res = await discardMigration(tenantId, jobId);
    expect(res.status).toBe("ok");

    // Quarantined import gone.
    expect(await contactsForJob(jobId)).toHaveLength(0);
    expect(await conversationsForJob(jobId)).toHaveLength(0);
    expect(await messagesForJob(jobId)).toHaveLength(0);
    const raw = await db
      .select()
      .from(migrationRawDataTable)
      .where(eq(migrationRawDataTable.jobId, jobId));
    expect(raw).toHaveLength(0);

    // Live data survives.
    const liveContactStill = await db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.id, liveContact.id));
    expect(liveContactStill).toHaveLength(1);
    const liveConvStill = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, liveConv.id));
    expect(liveConvStill).toHaveLength(1);

    expect((await jobRow(jobId))?.status).toBe("discarded");
  });

  it("is idempotent — re-discarding returns already_discarded", async () => {
    const tenantId = await makeTenant();
    const jobId = await makeJob(tenantId, { status: "failed" });
    expect((await discardMigration(tenantId, jobId)).status).toBe("ok");
    expect((await discardMigration(tenantId, jobId)).status).toBe(
      "already_discarded",
    );
  });

  it("forbids discard while a worker could be mid-write (hydrating)", async () => {
    const tenantId = await makeTenant();
    const jobId = await makeJob(tenantId, { status: "hydrating" });
    const res = await discardMigration(tenantId, jobId);
    expect(res.status).toBe("forbidden");
  });
});

describe("flipMigrationLive — merge, clear, idempotency, collision", () => {
  it("merges a quarantined contact into a live one and clears quarantine", async () => {
    const tenantId = await makeTenant();
    const jobId = await makeJob(tenantId, { status: "complete", summary: {} });
    const phone = uniquePhone();

    const [live] = await db
      .insert(contactsTable)
      .values({ tenantId, phone, name: "Live", isQuarantined: false })
      .returning({ id: contactsTable.id });
    const [qContact] = await db
      .insert(contactsTable)
      .values({
        tenantId,
        phone,
        isQuarantined: true,
        migrationJobId: jobId,
        importExternalId: `phone:${phone}`,
      })
      .returning({ id: contactsTable.id });
    const [qConv] = await db
      .insert(conversationsTable)
      .values({
        tenantId,
        contactId: qContact.id,
        contactPhone: phone,
        isQuarantined: true,
        migrationJobId: jobId,
        importExternalId: "qc1",
      })
      .returning({ id: conversationsTable.id });
    await db.insert(messagesTable).values({
      conversationId: qConv.id,
      direction: "inbound",
      body: "imported",
      isQuarantined: true,
      migrationJobId: jobId,
      importExternalId: "qm1",
    });

    const res = await flipMigrationLive(tenantId, jobId);
    expect(res).toEqual({ status: "ok", merged: 1 });

    // The duplicate quarantined contact is gone; the live one remains.
    const remaining = await contactsForJob(jobId);
    expect(remaining).toHaveLength(0);
    const liveStill = await db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.id, live.id));
    expect(liveStill[0].isQuarantined).toBe(false);

    // The conversation is repointed onto the live contact and de-quarantined.
    const convs = await conversationsForJob(jobId);
    expect(convs[0].contactId).toBe(live.id);
    expect(convs[0].isQuarantined).toBe(false);
    const msgs = await messagesForJob(jobId);
    expect(msgs[0].isQuarantined).toBe(false);

    // flippedAt is stamped, and a second flip is a no-op.
    const row = await jobRow(jobId);
    expect((row?.summary as Record<string, unknown>)?.flippedAt).toBeTruthy();
    expect((await flipMigrationLive(tenantId, jobId)).status).toBe(
      "already_flipped",
    );
  });

  it("promotes quarantined rows in place when no live contact exists", async () => {
    const tenantId = await makeTenant();
    const jobId = await makeJob(tenantId, { status: "complete", summary: {} });
    const phone = uniquePhone();

    const [qContact] = await db
      .insert(contactsTable)
      .values({
        tenantId,
        phone,
        isQuarantined: true,
        migrationJobId: jobId,
        importExternalId: `phone:${phone}`,
      })
      .returning({ id: contactsTable.id });
    await db.insert(conversationsTable).values({
      tenantId,
      contactId: qContact.id,
      contactPhone: phone,
      isQuarantined: true,
      migrationJobId: jobId,
      importExternalId: "qc1",
    });

    const res = await flipMigrationLive(tenantId, jobId);
    expect(res).toEqual({ status: "ok", merged: 0 });

    const contacts = await contactsForJob(jobId);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].isQuarantined).toBe(false);
    const convs = await conversationsForJob(jobId);
    expect(convs[0].isQuarantined).toBe(false);
  });

  it("fails closed with a collision when clearing would violate the live unique index", async () => {
    const tenantId = await makeTenant();
    const jobId = await makeJob(tenantId, { status: "complete", summary: {} });
    const phone = uniquePhone();

    // Two quarantined contacts sharing a phone (no live contact). The merge step
    // finds no live match, so both survive to the clear — where flipping both to
    // is_quarantined=false would violate the partial unique (tenant,phone) index.
    // The action must catch the 23505, roll back, and report a collision.
    await db.insert(contactsTable).values([
      {
        tenantId,
        phone,
        isQuarantined: true,
        migrationJobId: jobId,
        importExternalId: `phone:${phone}:a`,
      },
      {
        tenantId,
        phone,
        isQuarantined: true,
        migrationJobId: jobId,
        importExternalId: `phone:${phone}:b`,
      },
    ]);

    const res = await flipMigrationLive(tenantId, jobId);
    expect(res.status).toBe("collision");

    // Rolled back: both contacts are still quarantined, job not flipped.
    const contacts = await contactsForJob(jobId);
    expect(contacts).toHaveLength(2);
    for (const c of contacts) expect(c.isQuarantined).toBe(true);
    const row = await jobRow(jobId);
    expect((row?.summary as Record<string, unknown>)?.flippedAt).toBeFalsy();
  });
});

describe("flip/discard — message mutations are tenant-scoped", () => {
  // `messages` has no tenant_id; it is scoped via its conversation. A corrupted
  // or malformed migration_job_id association could otherwise let a Phase-3
  // action reach another tenant's messages. These adversarial cases plant a
  // quarantined message in tenant B that carries tenant A's job id and prove the
  // conversation-ownership scoping never touches it.
  async function plantQuarantinedImport(tenantId: number, jobId: number) {
    const phone = uniquePhone();
    const [contact] = await db
      .insert(contactsTable)
      .values({
        tenantId,
        phone,
        isQuarantined: true,
        migrationJobId: jobId,
        importExternalId: `phone:${phone}`,
      })
      .returning({ id: contactsTable.id });
    const [conv] = await db
      .insert(conversationsTable)
      .values({
        tenantId,
        contactId: contact.id,
        contactPhone: phone,
        isQuarantined: true,
        migrationJobId: jobId,
        importExternalId: `qc-${phone}`,
      })
      .returning({ id: conversationsTable.id });
    const [msg] = await db
      .insert(messagesTable)
      .values({
        conversationId: conv.id,
        direction: "inbound",
        body: "A import",
        isQuarantined: true,
        migrationJobId: jobId,
        importExternalId: `qm-${phone}`,
      })
      .returning({ id: messagesTable.id });
    return { convId: conv.id, msgId: msg.id };
  }

  // A normal tenant-B conversation whose message is (adversarially) tagged with
  // tenant A's job id.
  async function plantForeignMessage(tenantId: number, foreignJobId: number) {
    const phone = uniquePhone();
    const [contact] = await db
      .insert(contactsTable)
      .values({ tenantId, phone, isQuarantined: true })
      .returning({ id: contactsTable.id });
    const [conv] = await db
      .insert(conversationsTable)
      .values({
        tenantId,
        contactId: contact.id,
        contactPhone: phone,
        isQuarantined: true,
      })
      .returning({ id: conversationsTable.id });
    const [msg] = await db
      .insert(messagesTable)
      .values({
        conversationId: conv.id,
        direction: "inbound",
        body: "B must survive",
        isQuarantined: true,
        migrationJobId: foreignJobId,
        importExternalId: `bqm-${phone}`,
      })
      .returning({ id: messagesTable.id });
    return msg.id;
  }

  it("discard never deletes another tenant's message that shares the job id", async () => {
    const tenantA = await makeTenant();
    const tenantB = await makeTenant();
    const jobId = await makeJob(tenantA, { status: "review" });

    const a = await plantQuarantinedImport(tenantA, jobId);
    const bMsgId = await plantForeignMessage(tenantB, jobId);

    const res = await discardMigration(tenantA, jobId);
    expect(res.status).toBe("ok");

    // Tenant A's import message is deleted.
    const aStill = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(eq(messagesTable.id, a.msgId));
    expect(aStill).toHaveLength(0);

    // Tenant B's message survives — discard is scoped to tenant A's conversations.
    const bStill = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(eq(messagesTable.id, bMsgId));
    expect(bStill).toHaveLength(1);
  });

  it("flip never de-quarantines another tenant's message that shares the job id", async () => {
    const tenantA = await makeTenant();
    const tenantB = await makeTenant();
    const jobId = await makeJob(tenantA, { status: "complete", summary: {} });

    const a = await plantQuarantinedImport(tenantA, jobId);
    const bMsgId = await plantForeignMessage(tenantB, jobId);

    const res = await flipMigrationLive(tenantA, jobId);
    expect(res.status).toBe("ok");

    // Tenant A's import message is cleared.
    const [aMsg] = await db
      .select({ isQuarantined: messagesTable.isQuarantined })
      .from(messagesTable)
      .where(eq(messagesTable.id, a.msgId));
    expect(aMsg?.isQuarantined).toBe(false);

    // Tenant B's message stays quarantined — flip is scoped to tenant A's convs.
    const [bMsg] = await db
      .select({ isQuarantined: messagesTable.isQuarantined })
      .from(messagesTable)
      .where(eq(messagesTable.id, bMsgId));
    expect(bMsg?.isQuarantined).toBe(true);
  });
});
