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
  autopilotTurnEventsTable,
  type Tenant,
} from "@workspace/db";
import { runInboundAiPipeline } from "./inboundAiPipeline";
import {
  triageInbound,
  routerConfigured,
  type RouterDecision,
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
  type ProfessorEscalation,
} from "./knowledge";
import { professorConfigured } from "./grokClient";
import { sendConversationReply } from "./outboundReply";
import { checkOutboundCompliance } from "./compliance";

// ---------------------------------------------------------------------------
// CO-PILOT fallback holding phrase (DB-backed). Mirrors
// inboundAiPipeline.router.test — the REAL database with real seeded rows,
// mocking ONLY the external seams (router, Student/flash, retrieval, escalation,
// compliance, SMS sender) so the assertions read REAL persisted ai-state.
//
// Invariants under test:
//   - Co-Pilot + fallbackPhrase set + UNGROUNDED → drafts the phrase VERBATIM,
//     draftSource=fallback_phrase; never sends, never learns.
//   - FAIL-OPEN: empty fallbackPhrase → the Student's own draft stands (the
//     Professor was removed from the runtime path; it no longer escalates).
//   - GROUNDED inbound (strong FTS) → fallback NOT used; grounded Student draft.
//   - Auto-Pilot + fallbackPhrase set → fallback NEVER used (path unchanged).
//   - Manual + fallbackPhrase set → no draft at all.
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

const RUN = `aifallback-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const phone = `+1985${String(Date.now()).slice(-7)}`;
const BRAND_SCOPE = "We sell HVAC parts and supplies to licensed contractors.";
const FALLBACK =
  "Thanks for reaching out! Let me confirm the exact details for your account and get right back to you shortly.";

function routed(over: Partial<RouterDecision>): RouterDecision {
  return {
    status: "routed",
    intent: "tenant_specific",
    confidence: "high",
    declineMessage: "",
    detail: "",
    latencyMs: 1,
    ...over,
  };
}

// An ungrounded but well-formed Student draft → without a fallback phrase this
// is now staged as-is for the human (the Professor was removed from the runtime
// path; it no longer escalates).
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

const FLASH_DRAFT: StudentFlashDraft = {
  status: "drafted",
  whisperBody: "[SAMA Student FLASH] drafted",
  detail: "ok",
  latencyMs: 5,
  draftReply: "A heat pump moves heat; a furnace burns fuel to make heat.",
  kbMatched: false,
  groundedInClassroom: false,
};

const ESCALATION = {
  status: "answered",
  confidence: "high",
  facts: [
    {
      statement: "General HVAC guidance.",
      category: "general",
      provenance: "professor",
    },
  ],
  customerReply:
    "Here's some general guidance — want me to confirm the specifics for your unit?",
  engagementQuestions: [],
  tokensUsed: 20,
} as unknown as ProfessorEscalation;

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
      name: `AI fallback ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: phone,
      engagementMode: "copilot",
      brandScope: BRAND_SCOPE,
      fallbackPhrase: FALLBACK,
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
  // is ON and routes tenant_specific so the pipeline falls through to the
  // Student draft + fallback block (the realistic path).
  vi.mocked(routerConfigured).mockReturnValue(true);
  vi.mocked(triageInbound).mockResolvedValue(
    routed({ intent: "tenant_specific" }),
  );
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
  vi.mocked(professorEscalate).mockResolvedValue(ESCALATION);
  vi.mocked(persistEscalatedFacts).mockResolvedValue({
    persisted: 1,
    versionId: 1,
  } as unknown as Awaited<ReturnType<typeof persistEscalatedFacts>>);
  vi.mocked(professorConfigured).mockReturnValue(true);
  vi.mocked(checkOutboundCompliance).mockResolvedValue({
    ok: true,
  } as unknown as Awaited<ReturnType<typeof checkOutboundCompliance>>);

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      tenantId,
      contactPhone: `+1558${Math.floor(Math.random() * 1e7)}`,
      contactName: "Fallback Test",
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
    .delete(autopilotTurnEventsTable)
    .where(eq(autopilotTurnEventsTable.tenantId, tenantId));
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
    .delete(autopilotTurnEventsTable)
    .where(eq(autopilotTurnEventsTable.tenantId, tenantId));
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

describe("runInboundAiPipeline — Co-Pilot fallback holding phrase", () => {
  it("ungrounded + fallback set → drafts the phrase VERBATIM; Professor skipped; NO send, NO learn", async () => {
    await run();

    // We still draft via the Student to derive the grounding signal, but the
    // Professor escalation is short-circuited by the fallback early-return.
    expect(studentWhisper).toHaveBeenCalledTimes(1);
    expect(professorEscalate).not.toHaveBeenCalled();
    expect(persistEscalatedFacts).not.toHaveBeenCalled();
    expect(sendConversationReply).not.toHaveBeenCalled();

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("drafted");
    expect(states[0].draftSource).toBe("fallback_phrase");
    expect(states[0].draftBody).toBe(FALLBACK);

    // Co-Pilot never claims an auto-send slot.
    const claims = await db
      .select()
      .from(aiAutoRepliesTable)
      .where(eq(aiAutoRepliesTable.tenantId, tenantId));
    expect(claims).toHaveLength(0);
  });

  it("FAILS OPEN: empty fallback + ungrounded → Student draft stands (Professor removed from runtime)", async () => {
    await run({ tenant: { ...tenant, fallbackPhrase: "" } });

    expect(studentWhisper).toHaveBeenCalledTimes(1);
    // The Professor is no longer on the runtime path — the Student's own draft
    // is staged for the human instead of escalating.
    expect(professorEscalate).not.toHaveBeenCalled();

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("drafted");
    expect(states[0].draftSource).toBe("student");
    expect(states[0].draftBody).toBe(UNGROUNDED_DRAFT.draftReply.trim());
  });

  it("FAILS OPEN: whitespace-only fallback is treated as empty (Student draft, no Professor)", async () => {
    await run({ tenant: { ...tenant, fallbackPhrase: "   \n  " } });

    expect(professorEscalate).not.toHaveBeenCalled();
    const states = await readState();
    expect(states[0].draftSource).toBe("student");
  });

  it("GROUNDED inbound (strong FTS) → fallback NOT used; grounded Student draft", async () => {
    vi.mocked(retrieveClassroomFactsWithMatch).mockResolvedValue({
      facts: [
        {
          statement: "Filters ship same-day before 3pm ET.",
          sourceLabel: "Classroom",
          category: "general",
        },
      ],
      matchType: "fts",
      topRank: 1,
    } as unknown as Awaited<ReturnType<typeof retrieveClassroomFactsWithMatch>>);

    await run();

    // Strong FTS = grounded → neither the fallback nor the Professor fires.
    expect(professorEscalate).not.toHaveBeenCalled();
    expect(sendConversationReply).not.toHaveBeenCalled();

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("drafted");
    expect(states[0].draftSource).toBe("student");
  });

  it("Auto-Pilot + fallback set → the Co-Pilot fallback phrase is NEVER used (closed-book ack instead)", async () => {
    vi.mocked(sendConversationReply).mockResolvedValue({
      ok: true,
      status: "sent",
      messageRow: { id: 7101 },
      sendSummary: {},
    } as unknown as Awaited<ReturnType<typeof sendConversationReply>>);

    await run({ tenant: { ...tenant, engagementMode: "autopilot" } });

    // Auto-Pilot is fail-OPEN: it sends its OWN closed-book out-of-scope ack, but
    // must NEVER reuse the Co-Pilot fallback holding phrase (that path is frozen).
    expect(sendConversationReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendConversationReply).mock.calls[0][0].body).not.toBe(
      FALLBACK,
    );

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("auto_sent");
    expect(states[0].draftSource).not.toBe("fallback_phrase");
  });

  it("Manual + fallback set → no draft at all", async () => {
    await run({ tenant: { ...tenant, engagementMode: "manual" } });

    expect(studentWhisper).not.toHaveBeenCalled();

    const states = await readState();
    const live = states.filter(
      (s) => s.status === "drafted" || s.status === "auto_sent",
    );
    expect(live).toHaveLength(0);
  });
});
