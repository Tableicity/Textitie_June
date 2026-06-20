import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  conversationsTable,
  conversationAiStatesTable,
  messagesTable,
  phoneNumbersTable,
} from "@workspace/db";
import {
  stageCopilotDraftForInbound,
  finalizeCopilotDraftForInbound,
  markConversationAiStateHumanHandled,
} from "./aiStateStore";

// These exercise the Co-Pilot streaming concurrency guards directly against the
// DB: the early stream write (stageCopilotDraftForInbound), the
// finalize-in-place (finalizeCopilotDraftForInbound), and the human-takeover
// stamp (markConversationAiStateHumanHandled). The invariant under test: a
// late-firing async write must NEVER clobber a newer inbound turn or a
// current-turn human takeover, while a fresh turn must still be able to replace
// a stale prior-turn disposition.

const RUN = `aistateconc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const phone = `+1983${String(Date.now()).slice(-7)}`;
let tenantId = 0;

async function makeConversation(): Promise<number> {
  const [row] = await db
    .insert(conversationsTable)
    .values({
      tenantId,
      contactPhone: `+1555${Math.floor(Math.random() * 1e7)}`,
      contactName: "Concurrency Test",
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

async function stateFor(conversationId: number) {
  const rows = await db
    .select()
    .from(conversationAiStatesTable)
    .where(eq(conversationAiStatesTable.conversationId, conversationId))
    .limit(1);
  return rows[0] ?? null;
}

beforeAll(async () => {
  const [row] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: `AI state concurrency ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: phone,
      engagementMode: "copilot",
    })
    .returning({ id: tenantsTable.id });
  tenantId = row.id;
  await db
    .insert(phoneNumbersTable)
    .values({ phoneNumber: phone, tenantId, kind: "primary" });
});

afterAll(async () => {
  if (!tenantId) return;
  const convs = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(eq(conversationsTable.tenantId, tenantId));
  for (const c of convs) {
    await db
      .delete(conversationAiStatesTable)
      .where(eq(conversationAiStatesTable.conversationId, c.id));
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, c.id));
  }
  await db.delete(conversationsTable).where(eq(conversationsTable.tenantId, tenantId));
  await db.delete(phoneNumbersTable).where(eq(phoneNumbersTable.tenantId, tenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("stageCopilotDraftForInbound — concurrency guard", () => {
  it("inserts when no row exists, and updates the same turn in place", async () => {
    const conv = await makeConversation();
    const m1 = await addInbound(conv, "hi");

    const first = await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m1,
      draftBody: "early",
      draftSource: "professor",
    });
    expect(first).toBe(true);
    let row = await stateFor(conv);
    expect(row?.status).toBe("drafted");
    expect(row?.draftBody).toBe("early");

    const second = await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m1,
      draftBody: "refined",
      draftSource: "professor",
    });
    expect(second).toBe(true);
    row = await stateFor(conv);
    expect(row?.draftBody).toBe("refined");
  });

  it("does NOT clobber a newer inbound turn (late callback from an old turn)", async () => {
    const conv = await makeConversation();
    const m1 = await addInbound(conv, "first");
    const m2 = await addInbound(conv, "second");

    // The newer turn (m2) staged its draft first.
    await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m2,
      draftBody: "newer turn draft",
      draftSource: "professor",
    });

    // A late callback from the OLD turn (m1) tries to write — must no-op.
    const late = await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m1,
      draftBody: "stale old draft",
      draftSource: "professor",
    });
    expect(late).toBe(false);
    const row = await stateFor(conv);
    expect(row?.latestInboundMessageId).toBe(m2);
    expect(row?.draftBody).toBe("newer turn draft");
  });

  it("does NOT clobber a human takeover of the current turn", async () => {
    const conv = await makeConversation();
    const m1 = await addInbound(conv, "question");

    await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m1,
      draftBody: "professor draft",
      draftSource: "professor",
    });
    // Human grabs the wheel mid-stream.
    const flipped = await markConversationAiStateHumanHandled({
      tenantId,
      conversationId: conv,
      humanHandledBy: 42,
    });
    expect(flipped).toBe(true);

    // A late stream write must not revert human_handled back to drafted.
    const late = await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m1,
      draftBody: "late professor draft",
      draftSource: "professor",
    });
    expect(late).toBe(false);
    const row = await stateFor(conv);
    expect(row?.status).toBe("human_handled");
  });

  it("DOES overwrite a stale prior-turn human_handled for a fresh inbound turn", async () => {
    const conv = await makeConversation();
    const m1 = await addInbound(conv, "first question");

    await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m1,
      draftBody: "first draft",
      draftSource: "professor",
    });
    await markConversationAiStateHumanHandled({
      tenantId,
      conversationId: conv,
      humanHandledBy: 7,
    });
    // human_handled is now stamped at m1 (the latest inbound at that time).
    let row = await stateFor(conv);
    expect(row?.status).toBe("human_handled");
    expect(row?.latestInboundMessageId).toBe(m1);

    // A NEW inbound turn arrives; the fresh draft must replace last turn's
    // human_handled (there is no inbound-start reset in the Co-Pilot path).
    const m2 = await addInbound(conv, "second question");
    const staged = await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m2,
      draftBody: "second draft",
      draftSource: "professor",
    });
    expect(staged).toBe(true);
    row = await stateFor(conv);
    expect(row?.status).toBe("drafted");
    expect(row?.draftBody).toBe("second draft");
    expect(row?.latestInboundMessageId).toBe(m2);
  });
});

describe("markConversationAiStateHumanHandled — turn stamping", () => {
  it("stamps the conversation's LATEST inbound id even when the human sends before the AI drafted", async () => {
    const conv = await makeConversation();
    await addInbound(conv, "older");
    const m2 = await addInbound(conv, "current");

    // A stale prior row exists at an older turn, in a HUMAN_TAKEABLE status.
    await db.insert(conversationAiStatesTable).values({
      tenantId,
      conversationId: conv,
      status: "drafted",
      draftBody: "stale prior draft",
      latestInboundMessageId: null,
    });

    const flipped = await markConversationAiStateHumanHandled({
      tenantId,
      conversationId: conv,
      humanHandledBy: 99,
    });
    expect(flipped).toBe(true);
    const row = await stateFor(conv);
    expect(row?.status).toBe("human_handled");
    // Stamped to the latest inbound (m2), so a same-turn late stream write is
    // correctly fenced out.
    expect(row?.latestInboundMessageId).toBe(m2);

    const late = await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m2,
      draftBody: "late draft after human",
      draftSource: "professor",
    });
    expect(late).toBe(false);
  });
});

describe("finalizeCopilotDraftForInbound — guarded finalize", () => {
  it("fills confidence in place for the same inbound turn", async () => {
    const conv = await makeConversation();
    const m1 = await addInbound(conv, "q");
    await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m1,
      draftBody: "draft",
      draftSource: "professor",
      confidence: null,
    });
    await finalizeCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m1,
      draftBody: "final draft",
      draftSource: "professor",
      confidence: "high",
    });
    const row = await stateFor(conv);
    expect(row?.draftBody).toBe("final draft");
    expect(row?.confidence).toBe("high");
  });

  it("no-ops when a human took over the same turn", async () => {
    const conv = await makeConversation();
    const m1 = await addInbound(conv, "q");
    await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m1,
      draftBody: "draft",
      draftSource: "professor",
    });
    await markConversationAiStateHumanHandled({
      tenantId,
      conversationId: conv,
      humanHandledBy: 1,
    });
    await finalizeCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m1,
      draftBody: "should not apply",
      draftSource: "professor",
      confidence: "high",
    });
    const row = await stateFor(conv);
    expect(row?.status).toBe("human_handled");
  });

  it("no-ops when a newer inbound turn replaced the row", async () => {
    const conv = await makeConversation();
    const m1 = await addInbound(conv, "first");
    const m2 = await addInbound(conv, "second");
    await stageCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m2,
      draftBody: "newer draft",
      draftSource: "professor",
    });
    // A late finalize from the OLD turn (m1) must not touch the newer row.
    await finalizeCopilotDraftForInbound({
      tenantId,
      conversationId: conv,
      latestInboundMessageId: m1,
      draftBody: "stale finalize",
      draftSource: "professor",
      confidence: "low",
    });
    const row = await stateFor(conv);
    expect(row?.draftBody).toBe("newer draft");
    expect(row?.latestInboundMessageId).toBe(m2);
  });
});
