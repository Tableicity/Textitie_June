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
import { eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  conversationsTable,
  messagesTable,
  aiAutoRepliesTable,
  conversationAiStatesTable,
  type Tenant,
} from "@workspace/db";
import { runInboundAiPipeline } from "./inboundAiPipeline";
import {
  triageInbound,
  routerConfigured,
} from "@workspace/ai-router";
import {
  studentWhisper,
  studentFlashDraft,
  type StudentDraft,
  type StudentFlashDraft,
} from "@workspace/ai-student";
import {
  retrieveClassroomFactsWithMatch,
  classifyQueryCategory,
  hasUnresolvedConflicts,
  retrieveLibraryContext,
  professorEscalate,
  persistEscalatedFacts,
  type FactCategory,
} from "./knowledge";
import { professorConfigured } from "./grokClient";
import { sendConversationReply } from "./outboundReply";
import { checkOutboundCompliance } from "./compliance";

// ---------------------------------------------------------------------------
// AUTO-PILOT graceful handback holding ack (DB-backed). Mirrors
// inboundAiPipeline.fallback.test — the REAL database with real seeded rows,
// mocking ONLY the external seams (router, Student/flash, retrieval, escalation,
// compliance, SMS sender) so the assertions read REAL persisted ai-state.
//
// Invariants under test:
//   - Auto-Pilot gate REFUSES (or the draft FAILS) + holding phrase set →
//     auto-sends the phrase VERBATIM, KEEPS the Blue handback (status
//     refused/failed), preserves the AI's real draft, records the ack marker,
//     never learns.
//   - Empty/whitespace phrase → today's silent Blue handback (no send, no ack).
//   - Compliance re-checked at SEND time → block = silent, claim released.
//   - Throttle: at most ONE ack per waiting episode; a human reply ends it.
//   - Idempotent via the ai_auto_replies claim (a webhook retry never re-sends).
// ---------------------------------------------------------------------------

vi.mock("@workspace/ai-router", async () => {
  const actual =
    await vi.importActual<typeof import("@workspace/ai-router")>(
      "@workspace/ai-router",
    );
  return { ...actual, triageInbound: vi.fn(), routerConfigured: vi.fn() };
});
vi.mock("@workspace/ai-student", async () => {
  const actual =
    await vi.importActual<typeof import("@workspace/ai-student")>(
      "@workspace/ai-student",
    );
  return { ...actual, studentWhisper: vi.fn(), studentFlashDraft: vi.fn() };
});
vi.mock("./knowledge", async () => {
  const actual =
    await vi.importActual<typeof import("./knowledge")>("./knowledge");
  return {
    ...actual,
    retrieveClassroomFactsWithMatch: vi.fn(),
    classifyQueryCategory: vi.fn(),
    hasUnresolvedConflicts: vi.fn(),
    retrieveLibraryContext: vi.fn(),
    professorEscalate: vi.fn(),
    persistEscalatedFacts: vi.fn(),
  };
});
vi.mock("./grokClient", async () => {
  const actual =
    await vi.importActual<typeof import("./grokClient")>("./grokClient");
  return { ...actual, professorConfigured: vi.fn() };
});
vi.mock("./outboundReply", async () => {
  const actual =
    await vi.importActual<typeof import("./outboundReply")>("./outboundReply");
  return { ...actual, sendConversationReply: vi.fn() };
});
vi.mock("./compliance", async () => {
  const actual =
    await vi.importActual<typeof import("./compliance")>("./compliance");
  return { ...actual, checkOutboundCompliance: vi.fn() };
});

const RUN = `aiholdingack-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const phone = `+1986${String(Date.now()).slice(-7)}`;
const BRAND_SCOPE = "We sell HVAC parts and supplies to licensed contractors.";
const HOLDING =
  "Thanks for reaching out! A team member will get right back to you shortly.";
const OUTBOUND_ID = 778001;

// Ungrounded, well-formed Student draft → in Auto-Pilot the fail-closed gate
// refuses it (kbMatched false, no strong FTS, low confidence).
const UNGROUNDED_DRAFT: StudentDraft = {
  status: "drafted",
  whisperBody: "Customer asked a tenant-specific question.",
  detail: "ok",
  latencyMs: 5,
  draftReply: "Let me check on that and follow up.",
  kbMatched: false,
  confidence: "low",
  groundedInClassroom: false,
};

// Student produced no usable draft → the grok_error handback branch.
const FAILED_DRAFT: StudentDraft = {
  status: "failed",
  whisperBody: "",
  detail: "grok error",
  latencyMs: 5,
  draftReply: "",
  kbMatched: false,
  confidence: "low",
  groundedInClassroom: false,
};

const FLASH_DRAFT: StudentFlashDraft = {
  status: "drafted",
  whisperBody: "[SAMA Student FLASH] drafted",
  detail: "ok",
  latencyMs: 5,
  draftReply: "A heat pump moves heat; a furnace burns fuel to make heat.",
  kbMatched: false,
  groundedInClassroom: false,
};

let tenant: Tenant;
let tenantId = 0;
let conversationId = 0;
let inboundMessageId = 0;
let inboundSid = "";

function sentOk(messageId: number) {
  return {
    ok: true,
    status: "sent",
    messageRow: { id: messageId },
    sendSummary: {},
  } as unknown as Awaited<ReturnType<typeof sendConversationReply>>;
}

async function newInbound(): Promise<{ id: number; sid: string }> {
  const [msg] = await db
    .insert(messagesTable)
    .values({
      conversationId,
      direction: "inbound",
      body: "another question",
      read: false,
    })
    .returning({ id: messagesTable.id });
  return { id: msg.id, sid: `SM${Math.random().toString(36).slice(2, 14)}` };
}

beforeAll(async () => {
  const [row] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: `AI holding-ack ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: phone,
      engagementMode: "autopilot",
      brandScope: BRAND_SCOPE,
      autopilotHoldingPhrase: HOLDING,
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

  // Deterministic defaults; each test overrides what it cares about. The router
  // is irrelevant in Auto-Pilot (the Co-Pilot router block is skipped), and the
  // Professor is OFF so the ungrounded draft falls straight to the fail-closed
  // gate → refused → holding-ack handback.
  vi.mocked(routerConfigured).mockReturnValue(false);
  vi.mocked(triageInbound).mockResolvedValue({
    status: "routed",
    intent: "tenant_specific",
    confidence: "high",
    declineMessage: "",
    detail: "",
    latencyMs: 1,
  } as unknown as Awaited<ReturnType<typeof triageInbound>>);
  vi.mocked(studentWhisper).mockResolvedValue(UNGROUNDED_DRAFT);
  vi.mocked(studentFlashDraft).mockResolvedValue(FLASH_DRAFT);
  vi.mocked(retrieveClassroomFactsWithMatch).mockResolvedValue({
    facts: [],
    matchType: "none",
    topRank: 0,
  } as unknown as Awaited<ReturnType<typeof retrieveClassroomFactsWithMatch>>);
  vi.mocked(classifyQueryCategory).mockReturnValue("general" as FactCategory);
  vi.mocked(hasUnresolvedConflicts).mockResolvedValue(false);
  vi.mocked(retrieveLibraryContext).mockResolvedValue(
    [] as unknown as Awaited<ReturnType<typeof retrieveLibraryContext>>,
  );
  vi.mocked(professorEscalate).mockResolvedValue(
    null as unknown as Awaited<ReturnType<typeof professorEscalate>>,
  );
  vi.mocked(persistEscalatedFacts).mockResolvedValue({
    persisted: 1,
    versionId: 1,
  } as unknown as Awaited<ReturnType<typeof persistEscalatedFacts>>);
  vi.mocked(professorConfigured).mockReturnValue(false);
  vi.mocked(checkOutboundCompliance).mockResolvedValue({
    ok: true,
  } as unknown as Awaited<ReturnType<typeof checkOutboundCompliance>>);
  vi.mocked(sendConversationReply).mockResolvedValue(sentOk(OUTBOUND_ID));

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      tenantId,
      contactPhone: `+1557${Math.floor(Math.random() * 1e7)}`,
      contactName: "Holding Ack Test",
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
      body: "hello",
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

type PipelineCtx = Parameters<typeof runInboundAiPipeline>[0];
async function run(over: Partial<PipelineCtx> = {}) {
  await runInboundAiPipeline({
    tenant,
    tenantSlug: tenant.slug,
    conversationId,
    inboundMessageId,
    inboundSid,
    messageBody: "hello",
    fromNumber: "+15557654321",
    automationHandled: false,
    ...over,
  });
}

async function readState() {
  return db
    .select()
    .from(conversationAiStatesTable)
    .where(eq(conversationAiStatesTable.conversationId, conversationId));
}

async function readClaims() {
  return db
    .select()
    .from(aiAutoRepliesTable)
    .where(eq(aiAutoRepliesTable.tenantId, tenantId));
}

describe("runInboundAiPipeline — Auto-Pilot graceful handback holding ack", () => {
  it("gate refused + holding phrase → auto-sends phrase VERBATIM; stays Blue (refused); draft preserved; ack recorded; NO learn", async () => {
    await run();

    expect(sendConversationReply).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(sendConversationReply).mock.calls[0][0];
    expect(callArg.body).toBe(HOLDING);
    expect(callArg.conductorAuthorized).toBe(true);
    expect(callArg.runComplianceCheck).toBe(false);
    expect(persistEscalatedFacts).not.toHaveBeenCalled();

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("refused");
    expect(states[0].draftBody).toBe("Let me check on that and follow up.");
    expect(states[0].reasonText).toBe("Acknowledged — needs your reply");
    expect(states[0].handbackAckMessageId).toBe(OUTBOUND_ID);
    expect(states[0].handbackAckSentAt).not.toBeNull();

    // The claim is terminal (carries the outbound id) so retries stay idempotent.
    const claims = await readClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].inboundSid).toBe(inboundSid);
    expect(claims[0].outboundMessageId).toBe(OUTBOUND_ID);
  });

  it("empty holding phrase → today's SILENT Blue handback; no send; no ack cols", async () => {
    await run({ tenant: { ...tenant, autopilotHoldingPhrase: "" } });

    expect(sendConversationReply).not.toHaveBeenCalled();

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("refused");
    expect(states[0].handbackAckMessageId).toBeNull();
    expect(states[0].handbackAckSentAt).toBeNull();
    expect(states[0].reasonText).not.toBe("Acknowledged — needs your reply");

    const claims = await readClaims();
    expect(claims).toHaveLength(0);
  });

  it("whitespace-only holding phrase is treated as empty → silent", async () => {
    await run({ tenant: { ...tenant, autopilotHoldingPhrase: "   \n  " } });

    expect(sendConversationReply).not.toHaveBeenCalled();
    const states = await readState();
    expect(states[0].handbackAckSentAt).toBeNull();
  });

  it("compliance block at send time → no send; silent Blue; claim released", async () => {
    vi.mocked(checkOutboundCompliance).mockResolvedValue({
      ok: false,
      reason: "quiet_hours",
      message: "Outside allowed send window",
    } as unknown as Awaited<ReturnType<typeof checkOutboundCompliance>>);

    await run();

    expect(sendConversationReply).not.toHaveBeenCalled();

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("refused");
    expect(states[0].handbackAckMessageId).toBeNull();
    expect(states[0].handbackAckSentAt).toBeNull();

    // The claim was taken then released so a later inbound can retry.
    const claims = await readClaims();
    expect(claims).toHaveLength(0);
  });

  it("throttle: a second inbound while still waiting does NOT re-ack", async () => {
    await run();
    expect(sendConversationReply).toHaveBeenCalledTimes(1);

    const next = await newInbound();
    await run({ inboundMessageId: next.id, inboundSid: next.sid });

    // Still exactly one ack — the prior refused+ack short-circuits the throttle.
    expect(sendConversationReply).toHaveBeenCalledTimes(1);

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("refused");
    expect(states[0].handbackAckSentAt).not.toBeNull();
  });

  it("after a human reply (human_handled) a later inbound acks again (new episode)", async () => {
    await run();
    expect(sendConversationReply).toHaveBeenCalledTimes(1);

    // Simulate a human taking the wheel: the episode ends, the ack marker clears.
    await db
      .update(conversationAiStatesTable)
      .set({
        status: "human_handled",
        handbackAckMessageId: null,
        handbackAckSentAt: null,
      })
      .where(eq(conversationAiStatesTable.conversationId, conversationId));

    const next = await newInbound();
    await run({ inboundMessageId: next.id, inboundSid: next.sid });

    expect(sendConversationReply).toHaveBeenCalledTimes(2);
    const states = await readState();
    expect(states[0].status).toBe("refused");
    expect(states[0].handbackAckSentAt).not.toBeNull();
  });

  it("idempotency: a webhook retry of the same inbound does not double-send", async () => {
    await run();
    expect(sendConversationReply).toHaveBeenCalledTimes(1);

    // Drop the ai-state row so the throttle can't short-circuit; the claim guard
    // alone must prevent the retry from re-sending the same inbound.
    await db
      .delete(conversationAiStatesTable)
      .where(eq(conversationAiStatesTable.conversationId, conversationId));

    await run(); // same inboundSid

    expect(sendConversationReply).toHaveBeenCalledTimes(1);
    const claims = await readClaims();
    expect(claims).toHaveLength(1);
  });

  it("send returns {ok:false} → silent Blue handback; claim released; no ack marker", async () => {
    vi.mocked(sendConversationReply).mockResolvedValue({
      ok: false,
      reason: "twilio_error",
      errorMessage: "carrier rejected",
    } as unknown as Awaited<ReturnType<typeof sendConversationReply>>);

    await run();

    expect(sendConversationReply).toHaveBeenCalledTimes(1);
    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("refused");
    expect(states[0].handbackAckMessageId).toBeNull();
    expect(states[0].handbackAckSentAt).toBeNull();

    // Released so a webhook retry can re-attempt the ack.
    const claims = await readClaims();
    expect(claims).toHaveLength(0);
  });

  it("send THROWS before finalization → never throws past contract; silent Blue; claim released", async () => {
    vi.mocked(sendConversationReply).mockRejectedValue(
      new Error("network down"),
    );

    await expect(run()).resolves.toBeUndefined();

    expect(sendConversationReply).toHaveBeenCalledTimes(1);
    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("refused");
    expect(states[0].handbackAckSentAt).toBeNull();

    const claims = await readClaims();
    expect(claims).toHaveLength(0);
  });

  it("grok_error (no usable draft) + holding phrase → auto-sends phrase; stays Blue (failed); reason acked", async () => {
    vi.mocked(studentWhisper).mockResolvedValue(FAILED_DRAFT);

    await run();

    expect(sendConversationReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendConversationReply).mock.calls[0][0].body).toBe(HOLDING);
    expect(persistEscalatedFacts).not.toHaveBeenCalled();

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("failed");
    expect(states[0].draftBody).toBeNull();
    expect(states[0].reasonText).toBe("Acknowledged — needs your reply");
    expect(states[0].handbackAckMessageId).toBe(OUTBOUND_ID);
    expect(states[0].handbackAckSentAt).not.toBeNull();
  });
});
