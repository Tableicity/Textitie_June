import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  conversationsTable,
  messagesTable,
  aiAutoRepliesTable,
  conversationAiStatesTable,
  type Tenant,
  type ClassroomFact,
} from "@workspace/db";
import { runInboundAiPipeline } from "./inboundAiPipeline";
import { studentWhisper, type StudentDraft } from "@workspace/ai-student";
import {
  retrieveClassroomFactsWithMatch,
  classifyQueryCategory,
  hasUnresolvedConflicts,
  type FactCategory,
} from "./knowledge";
import { checkOutboundCompliance } from "./compliance";
import { sendConversationReply } from "./outboundReply";

// ---------------------------------------------------------------------------
// Auto-Pilot fault-tolerance regression (architect's 3rd suggestion).
//
// Invariant under test: in Auto-Pilot the pipeline CLAIMS the inbound SID in
// ai_auto_replies BEFORE it sends (idempotency, so a webhook retry can't
// double-text). If the actual SEND throws, the catch must:
//   1. DELETE that not-yet-finalized claim, so a retry can re-attempt;
//   2. write a Blue handback (conversation_ai_states.status="failed",
//      reasonCode="send_failed");
//   3. NOT learn anything;
//   4. NOT re-throw — a send failure is a terminal handback for THIS message,
//      not a whole-burst requeue.
// The complementary case: an UNEXPECTED failure (here, the Student throwing)
// MUST propagate so the inbound-AI worker requeues/dead-letters the burst.
//
// Approach mirrors the other DB-backed tests in this dir (e.g.
// inboundStageStore.test.ts): we use the REAL database and seed real rows, and
// mock ONLY the external seams — the SMS sender (sendConversationReply), the
// Grok/Student layer, and the retrieval/compliance helpers — so the assertions
// read REAL persisted state, not hand-fed mock returns. The DB itself is never
// mocked.
//
// Race safety: a live inbound-AI worker runs in the api-server workflow, but it
// only drives conversations via the staging table; this test calls
// runInboundAiPipeline directly and never stages a row, so nothing else can act
// on the seeded conversation.
// ---------------------------------------------------------------------------

// Replace ONLY the seams. importActual keeps every other export (and the types)
// real so the pipeline's other imports from these modules still resolve.
vi.mock("./outboundReply", async () => {
  const actual =
    await vi.importActual<typeof import("./outboundReply")>("./outboundReply");
  return { ...actual, sendConversationReply: vi.fn() };
});
vi.mock("@workspace/ai-student", async () => {
  const actual =
    await vi.importActual<typeof import("@workspace/ai-student")>(
      "@workspace/ai-student",
    );
  return { ...actual, studentWhisper: vi.fn() };
});
vi.mock("./knowledge", async () => {
  const actual =
    await vi.importActual<typeof import("./knowledge")>("./knowledge");
  return {
    ...actual,
    retrieveClassroomFactsWithMatch: vi.fn(),
    classifyQueryCategory: vi.fn(),
    hasUnresolvedConflicts: vi.fn(),
  };
});
vi.mock("./compliance", async () => {
  const actual =
    await vi.importActual<typeof import("./compliance")>("./compliance");
  return { ...actual, checkOutboundCompliance: vi.fn() };
});

const RUN = `aithrow-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const phone = `+1983${String(Date.now()).slice(-7)}`;

// A grounded, high-confidence, safe-category draft — everything evaluateAutoSend
// needs to pass so execution actually reaches the (mocked, throwing) send.
const GOOD_DRAFT: StudentDraft = {
  status: "drafted",
  whisperBody: "Customer asked about opening hours.",
  detail: "ok",
  latencyMs: 5,
  draftReply: "We're open 9am to 5pm, Monday through Friday.",
  kbMatched: true,
  confidence: "high",
  groundedInClassroom: true,
};

// One safe ("general") grounding fact so groundingCategories is non-empty and
// all-safe. Cast: the pipeline only reads statement/sourceLabel/category.
const GROUNDING_FACTS = [
  {
    statement: "We are open 9am to 5pm, Monday through Friday.",
    sourceLabel: "Hours FAQ",
    category: "general",
  },
] as unknown as ClassroomFact[];

let tenant: Tenant;
let tenantId = 0;
let conversationId = 0;
let inboundMessageId = 0;
let inboundSid = "";

beforeAll(async () => {
  const [row] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: `AI throw ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: phone,
      engagementMode: "autopilot",
    })
    .returning({ id: tenantsTable.id });
  tenantId = row.id;
  const [full] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  tenant = full;
});

beforeEach(async () => {
  vi.clearAllMocks();

  // Safe defaults so the pipeline reaches the auto-send block deterministically.
  vi.mocked(studentWhisper).mockResolvedValue(GOOD_DRAFT);
  vi.mocked(retrieveClassroomFactsWithMatch).mockResolvedValue({
    facts: GROUNDING_FACTS,
    matchType: "fts",
    topRank: 0.5,
  });
  vi.mocked(classifyQueryCategory).mockReturnValue("general" as FactCategory);
  vi.mocked(hasUnresolvedConflicts).mockResolvedValue(false);
  vi.mocked(checkOutboundCompliance).mockResolvedValue({
    ok: true,
  } as unknown as Awaited<ReturnType<typeof checkOutboundCompliance>>);

  // Fresh conversation + inbound message per test.
  const [conv] = await db
    .insert(conversationsTable)
    .values({
      tenantId,
      contactPhone: `+1556${Math.floor(Math.random() * 1e7)}`,
      contactName: "Throw Test",
      status: "open",
      lastMessageAt: new Date(),
    })
    .returning({ id: conversationsTable.id });
  conversationId = conv.id;

  const [msg] = await db
    .insert(messagesTable)
    .values({
      conversationId,
      direction: "inbound",
      body: "What time do you open?",
      read: false,
    })
    .returning({ id: messagesTable.id });
  inboundMessageId = msg.id;

  inboundSid = `SM${Math.random().toString(36).slice(2, 14)}`;
});

afterEach(async () => {
  if (!tenantId) return;
  await db
    .delete(conversationAiStatesTable)
    .where(eq(conversationAiStatesTable.tenantId, tenantId));
  await db
    .delete(aiAutoRepliesTable)
    .where(eq(aiAutoRepliesTable.tenantId, tenantId));
});

afterAll(async () => {
  if (!tenantId) return;
  const convs = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(eq(conversationsTable.tenantId, tenantId));
  await db
    .delete(conversationAiStatesTable)
    .where(eq(conversationAiStatesTable.tenantId, tenantId));
  await db
    .delete(aiAutoRepliesTable)
    .where(eq(aiAutoRepliesTable.tenantId, tenantId));
  for (const c of convs) {
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, c.id));
  }
  await db
    .delete(conversationsTable)
    .where(eq(conversationsTable.tenantId, tenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("runInboundAiPipeline — Auto-Pilot send-throw fault tolerance", () => {
  it("releases the claim and writes a Blue handback (failed/send_failed) WITHOUT re-throwing when the send throws", async () => {
    vi.mocked(sendConversationReply).mockRejectedValue(
      new Error("twilio exploded"),
    );

    // The send throws, but a thrown send is a terminal handback — it must NOT
    // propagate out of the pipeline.
    await expect(
      runInboundAiPipeline({
        tenant,
        tenantSlug: tenant.slug,
        conversationId,
        inboundMessageId,
        inboundSid,
        messageBody: "What time do you open?",
        fromNumber: "+15557654321",
        automationHandled: false,
      }),
    ).resolves.toBeUndefined();

    // The send was actually attempted (we reached the auto-send block).
    expect(sendConversationReply).toHaveBeenCalledTimes(1);

    // 1. Claim released: the not-yet-finalized ai_auto_replies row is deleted so
    //    a webhook/worker retry can re-attempt this inbound SID.
    const claims = await db
      .select()
      .from(aiAutoRepliesTable)
      .where(
        and(
          eq(aiAutoRepliesTable.tenantId, tenantId),
          eq(aiAutoRepliesTable.inboundSid, inboundSid),
        ),
      );
    expect(claims).toHaveLength(0);

    // 2. Blue handback persisted: status=failed, reasonCode=send_failed.
    const states = await db
      .select()
      .from(conversationAiStatesTable)
      .where(eq(conversationAiStatesTable.conversationId, conversationId));
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("failed");
    expect(states[0].reasonCode).toBe("send_failed");
    // 3. No learning: a failed send never marks the state auto_sent.
    expect(states[0].outboundMessageId).toBeNull();
    expect(states[0].autoSentAt).toBeNull();
  });

  it("re-throws when an UNEXPECTED pipeline failure occurs before the send (so the worker requeues the burst)", async () => {
    vi.mocked(studentWhisper).mockRejectedValue(
      new Error("Database connection timed out internally"),
    );

    await expect(
      runInboundAiPipeline({
        tenant,
        tenantSlug: tenant.slug,
        conversationId,
        inboundMessageId,
        inboundSid,
        messageBody: "What time do you open?",
        fromNumber: "+15557654321",
        automationHandled: false,
      }),
    ).rejects.toThrow("Database connection timed out internally");

    // The failure happened before the send block — no send, no claim.
    expect(sendConversationReply).not.toHaveBeenCalled();
    const claims = await db
      .select()
      .from(aiAutoRepliesTable)
      .where(
        and(
          eq(aiAutoRepliesTable.tenantId, tenantId),
          eq(aiAutoRepliesTable.inboundSid, inboundSid),
        ),
      );
    expect(claims).toHaveLength(0);
  });
});
