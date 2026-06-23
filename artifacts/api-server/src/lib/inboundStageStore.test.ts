import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  conversationsTable,
  messagesTable,
  phoneNumbersTable,
  conversationInboundAiStagesTable,
} from "@workspace/db";
import {
  enqueueInboundAiStage,
  gatherCoalescibleFollowups,
  finalizeCoalescedBurst,
  failCoalescedBurst,
  COALESCE_WINDOW_MS,
} from "./inboundStageStore";

// These exercise the durable inbound-AI staging store's NEW burst-coalescing
// logic directly against the DB: gatherCoalescibleFollowups (the arrival-gap
// burst walk), finalizeCoalescedBurst (anchor done + followups skipped, one tx)
// and failCoalescedBurst (the WHOLE burst requeued/dead-lettered together so a
// retry re-coalesces the identical set and never re-anchors idempotency).
//
// Race safety: a live worker is polling this same table in the api-server
// workflow. Its claim requires available_at <= now(), so every staged row here
// is inserted with a FAR-FUTURE available_at — the live worker can never claim
// them, making these assertions deterministic. The tenant is also `manual`
// (AI fully off) as a belt-and-suspenders no-op guard.

const RUN = `inboundstage-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const phone = `+1982${String(Date.now()).slice(-7)}`;
const FAR_FUTURE = () => new Date(Date.now() + 3_600_000);
let tenantId = 0;

async function makeConversation(): Promise<number> {
  const [row] = await db
    .insert(conversationsTable)
    .values({
      tenantId,
      contactPhone: `+1556${Math.floor(Math.random() * 1e7)}`,
      contactName: "Stage Test",
      status: "open",
      lastMessageAt: new Date(),
    })
    .returning({ id: conversationsTable.id });
  return row.id;
}

async function addInbound(conversationId: number, body: string): Promise<number> {
  const [row] = await db
    .insert(messagesTable)
    .values({ conversationId, direction: "inbound", body, read: false })
    .returning({ id: messagesTable.id });
  return row.id;
}

// Insert a staging row directly so receivedAt / status / attempts are fully
// controlled. available_at defaults far in the future so the live worker never
// claims it out from under the test.
async function insertStage(
  conversationId: number,
  opts: {
    receivedAt: Date;
    status?: string;
    attempts?: number;
    body?: string;
  },
): Promise<number> {
  const inboundMessageId = await addInbound(
    conversationId,
    opts.body ?? "stage body",
  );
  const [row] = await db
    .insert(conversationInboundAiStagesTable)
    .values({
      tenantId,
      conversationId,
      inboundMessageId,
      inboundSid: `SM${Math.random().toString(36).slice(2, 12)}`,
      messageBody: opts.body ?? "stage body",
      fromNumber: "+15550001111",
      status: opts.status ?? "queued",
      attempts: opts.attempts ?? 0,
      receivedAt: opts.receivedAt,
      availableAt: FAR_FUTURE(),
    })
    .returning({ id: conversationInboundAiStagesTable.id });
  return row.id;
}

async function stageById(id: number) {
  const rows = await db
    .select()
    .from(conversationInboundAiStagesTable)
    .where(eq(conversationInboundAiStagesTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

beforeAll(async () => {
  const [row] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: `Inbound stage ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: phone,
      engagementMode: "manual",
    })
    .returning({ id: tenantsTable.id });
  tenantId = row.id;
  await db
    .insert(phoneNumbersTable)
    .values({ phoneNumber: phone, tenantId, kind: "primary" });
});

afterEach(async () => {
  if (!tenantId) return;
  await db
    .delete(conversationInboundAiStagesTable)
    .where(eq(conversationInboundAiStagesTable.tenantId, tenantId));
});

afterAll(async () => {
  if (!tenantId) return;
  const convs = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(eq(conversationsTable.tenantId, tenantId));
  await db
    .delete(conversationInboundAiStagesTable)
    .where(eq(conversationInboundAiStagesTable.tenantId, tenantId));
  for (const c of convs) {
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, c.id));
  }
  await db
    .delete(conversationsTable)
    .where(eq(conversationsTable.tenantId, tenantId));
  await db.delete(phoneNumbersTable).where(eq(phoneNumbersTable.tenantId, tenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("enqueueInboundAiStage — idempotency + debounce", () => {
  it("inserts once and is a no-op on a carrier retry of the same inbound", async () => {
    const conv = await makeConversation();
    const m = await addInbound(conv, "hello");

    const first = await enqueueInboundAiStage({
      tenantId,
      conversationId: conv,
      inboundMessageId: m,
      inboundSid: "SMfirst",
      messageBody: "hello",
      fromNumber: "+15550002222",
    });
    expect(first).toBe(true);

    const retry = await enqueueInboundAiStage({
      tenantId,
      conversationId: conv,
      inboundMessageId: m,
      inboundSid: "SMfirst",
      messageBody: "hello",
      fromNumber: "+15550002222",
    });
    expect(retry).toBe(false);

    const rows = await db
      .select()
      .from(conversationInboundAiStagesTable)
      .where(eq(conversationInboundAiStagesTable.inboundMessageId, m));
    expect(rows.length).toBe(1);
    // Debounced: held back by the coalesce window so a rapid follow-up can land
    // and join this turn (available_at is in the future, not immediately ready).
    expect(rows[0].availableAt.getTime()).toBeGreaterThan(
      rows[0].receivedAt.getTime() + COALESCE_WINDOW_MS - 1_000,
    );
  });
});

describe("gatherCoalescibleFollowups — arrival-gap burst walk", () => {
  it("includes contiguous follow-ups within the window and stops at the first big gap", async () => {
    const conv = await makeConversation();
    const t = new Date(Date.now() - 120_000);
    await insertStage(conv, { receivedAt: t, body: "anchor" });
    const f1 = await insertStage(conv, {
      receivedAt: new Date(t.getTime() + 1_000),
      body: "f1",
    });
    const f2 = await insertStage(conv, {
      receivedAt: new Date(t.getTime() + 2_000),
      body: "f2",
    });
    // A clearly-separate later turn: gap from f2 exceeds the window.
    await insertStage(conv, {
      receivedAt: new Date(t.getTime() + 2_000 + COALESCE_WINDOW_MS + 5_000),
      body: "later turn",
    });

    const burst = await gatherCoalescibleFollowups(conv, t);
    expect(burst.map((b) => b.id)).toEqual([f1, f2]);
    expect(burst.map((b) => b.messageBody)).toEqual(["f1", "f2"]);
  });

  it("returns empty when the next text is already beyond the window", async () => {
    const conv = await makeConversation();
    const t = new Date(Date.now() - 120_000);
    await insertStage(conv, { receivedAt: t, body: "anchor" });
    await insertStage(conv, {
      receivedAt: new Date(t.getTime() + COALESCE_WINDOW_MS + 3_000),
      body: "separate",
    });

    const burst = await gatherCoalescibleFollowups(conv, t);
    expect(burst).toEqual([]);
  });

  it("ignores follow-ups that are not queued (already handled)", async () => {
    const conv = await makeConversation();
    const t = new Date(Date.now() - 120_000);
    await insertStage(conv, { receivedAt: t, body: "anchor" });
    await insertStage(conv, {
      receivedAt: new Date(t.getTime() + 1_000),
      status: "done",
      body: "already done",
    });
    const f2 = await insertStage(conv, {
      receivedAt: new Date(t.getTime() + 2_000),
      body: "still queued",
    });

    const burst = await gatherCoalescibleFollowups(conv, t);
    expect(burst.map((b) => b.id)).toEqual([f2]);
  });
});

describe("finalizeCoalescedBurst — atomic anchor-done + followups-skipped", () => {
  it("marks the anchor done and every follow-up skipped(coalesced)", async () => {
    const conv = await makeConversation();
    const t = new Date(Date.now() - 120_000);
    const anchor = await insertStage(conv, { receivedAt: t, body: "anchor" });
    const f1 = await insertStage(conv, {
      receivedAt: new Date(t.getTime() + 1_000),
      body: "f1",
    });
    const f2 = await insertStage(conv, {
      receivedAt: new Date(t.getTime() + 2_000),
      body: "f2",
    });

    await finalizeCoalescedBurst(anchor, [f1, f2]);

    expect((await stageById(anchor))?.status).toBe("done");
    for (const id of [f1, f2]) {
      const row = await stageById(id);
      expect(row?.status).toBe("skipped");
      expect(row?.skipReason).toBe("coalesced");
    }
  });

  it("handles a solo anchor with no follow-ups", async () => {
    const conv = await makeConversation();
    const anchor = await insertStage(conv, {
      receivedAt: new Date(Date.now() - 120_000),
      body: "solo",
    });
    await finalizeCoalescedBurst(anchor, []);
    expect((await stageById(anchor))?.status).toBe("done");
  });
});

describe("failCoalescedBurst — whole-burst retry / dead-letter together", () => {
  it("requeues the entire burst with the SAME available_at below the attempt cap", async () => {
    const conv = await makeConversation();
    const t = new Date(Date.now() - 120_000);
    const anchor = await insertStage(conv, {
      receivedAt: t,
      attempts: 1,
      body: "anchor",
    });
    const f1 = await insertStage(conv, {
      receivedAt: new Date(t.getTime() + 1_000),
      body: "f1",
    });

    await failCoalescedBurst(anchor, [f1], 1, "boom");

    const a = await stageById(anchor);
    const b = await stageById(f1);
    expect(a?.status).toBe("queued");
    expect(b?.status).toBe("queued");
    expect(a?.lastError).toContain("boom");
    // Backoff pushed available_at into the future, and the whole burst shares
    // the SAME available_at so the retry re-coalesces the identical set.
    expect(a?.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(b?.availableAt.getTime()).toBe(a?.availableAt.getTime());
  });

  it("dead-letters the entire burst at the attempt cap", async () => {
    const conv = await makeConversation();
    const t = new Date(Date.now() - 120_000);
    const anchor = await insertStage(conv, {
      receivedAt: t,
      attempts: 3,
      body: "anchor",
    });
    const f1 = await insertStage(conv, {
      receivedAt: new Date(t.getTime() + 1_000),
      body: "f1",
    });

    await failCoalescedBurst(anchor, [f1], 3, "dead");

    const ids = [anchor, f1];
    const rows = await db
      .select()
      .from(conversationInboundAiStagesTable)
      .where(inArray(conversationInboundAiStagesTable.id, ids));
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.status).toBe("failed");
  });
});
