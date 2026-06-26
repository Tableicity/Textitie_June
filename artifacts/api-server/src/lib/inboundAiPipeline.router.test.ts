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
// CO-PILOT triage router wiring (DB-backed). Mirrors inboundAiPipeline.throw.test
// — the REAL database with real seeded rows, mocking ONLY the external seams
// (router, Student/flash, retrieval, escalation, compliance, SMS sender) so the
// assertions read REAL persisted ai-state, not hand-fed mock returns. The DB is
// never mocked. resolveRouteBranch is kept REAL so the fail-safe policy is
// exercised end-to-end.
//
// Invariants under test:
//   - Co-Pilot general_in_scope  → studentFlashDraft drafts; NO Professor, NO
//                                   persistence, NO send; draftSource=student_flash.
//   - Co-Pilot out_of_scope      → decline drafted; NO flash, NO Professor, NO
//                                   send; draftSource=router_decline.
//   - Co-Pilot tenant_specific   → falls through to the EXISTING grounded path;
//                                   ungrounded still escalates; never learns.
//   - Router fails open (no brandScope / non-routed) → existing path runs.
//   - Auto-Pilot + Manual        → router is NEVER called (paths unchanged).
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

const RUN = `airouter-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const phone = `+1984${String(Date.now()).slice(-7)}`;
const BRAND_SCOPE = "We sell HVAC parts and supplies to licensed contractors.";

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

// An ungrounded but well-formed Student draft → triggers the Professor escalation
// branch (kbMatched false, no strong FTS match) in the tenant_specific path.
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
    { statement: "General HVAC guidance.", category: "general", provenance: "professor" },
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
      name: `AI router ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: phone,
      engagementMode: "copilot",
      brandScope: BRAND_SCOPE,
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

  // Deterministic defaults; each test overrides what it cares about.
  vi.mocked(routerConfigured).mockReturnValue(true);
  vi.mocked(triageInbound).mockResolvedValue(routed({ intent: "tenant_specific" }));
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
      contactPhone: `+1557${Math.floor(Math.random() * 1e7)}`,
      contactName: "Router Test",
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

describe("runInboundAiPipeline — Co-Pilot triage router", () => {
  it("general_in_scope → flash draft only; NO Professor, NO persistence, NO send", async () => {
    vi.mocked(triageInbound).mockResolvedValue(
      routed({ intent: "general_in_scope" }),
    );

    await run();

    expect(triageInbound).toHaveBeenCalledTimes(1);
    expect(studentFlashDraft).toHaveBeenCalledTimes(1);
    expect(studentWhisper).not.toHaveBeenCalled();
    expect(professorEscalate).not.toHaveBeenCalled();
    expect(persistEscalatedFacts).not.toHaveBeenCalled();
    expect(sendConversationReply).not.toHaveBeenCalled();

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("drafted");
    expect(states[0].draftSource).toBe("student_flash");
    expect(states[0].draftBody).toBe(FLASH_DRAFT.draftReply);

    const claims = await db
      .select()
      .from(aiAutoRepliesTable)
      .where(eq(aiAutoRepliesTable.tenantId, tenantId));
    expect(claims).toHaveLength(0);
  });

  it("out_of_scope → decline draft only; NO flash, NO Professor, NO send", async () => {
    vi.mocked(triageInbound).mockResolvedValue(
      routed({
        intent: "out_of_scope",
        declineMessage:
          "Sorry, we only handle HVAC parts — can't help with that.",
      }),
    );

    await run();

    expect(studentFlashDraft).not.toHaveBeenCalled();
    expect(studentWhisper).not.toHaveBeenCalled();
    expect(professorEscalate).not.toHaveBeenCalled();
    expect(persistEscalatedFacts).not.toHaveBeenCalled();
    expect(sendConversationReply).not.toHaveBeenCalled();

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("drafted");
    expect(states[0].draftSource).toBe("router_decline");
    expect(states[0].draftBody).toContain("HVAC");
  });

  it("tenant_specific (ungrounded) falls through and STILL escalates, but never learns", async () => {
    vi.mocked(triageInbound).mockResolvedValue(
      routed({ intent: "tenant_specific" }),
    );

    await run();

    expect(triageInbound).toHaveBeenCalledTimes(1);
    expect(studentFlashDraft).not.toHaveBeenCalled();
    expect(studentWhisper).toHaveBeenCalledTimes(1);
    expect(professorEscalate).toHaveBeenCalledTimes(1);
    // Co-Pilot NEVER learns, even when the Professor returns facts.
    expect(persistEscalatedFacts).not.toHaveBeenCalled();
    expect(sendConversationReply).not.toHaveBeenCalled();

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("drafted");
    expect(states[0].draftSource).toBe("professor");
    expect(states[0].draftBody).toBe(ESCALATION.customerReply.trim());
  });

  it("FAILS OPEN to the existing pipeline when brandScope is empty (router never called)", async () => {
    await run({ tenant: { ...tenant, brandScope: "" } });

    expect(triageInbound).not.toHaveBeenCalled();
    expect(studentFlashDraft).not.toHaveBeenCalled();
    expect(studentWhisper).toHaveBeenCalledTimes(1);

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("drafted");
  });

  it("FAILS OPEN to the existing pipeline when the router returns a non-routed status", async () => {
    vi.mocked(triageInbound).mockResolvedValue(
      routed({ status: "failed", intent: null, confidence: null }),
    );

    await run();

    expect(triageInbound).toHaveBeenCalledTimes(1);
    expect(studentFlashDraft).not.toHaveBeenCalled();
    expect(studentWhisper).toHaveBeenCalledTimes(1);
  });

  it("Auto-Pilot NEVER runs the router (path unchanged); gate refuses the ungrounded draft", async () => {
    vi.mocked(professorConfigured).mockReturnValue(false); // no escalation

    await run({ tenant: { ...tenant, engagementMode: "autopilot" } });

    expect(triageInbound).not.toHaveBeenCalled();
    expect(studentFlashDraft).not.toHaveBeenCalled();
    expect(studentWhisper).toHaveBeenCalledTimes(1);
    expect(sendConversationReply).not.toHaveBeenCalled();

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("refused");
  });

  it("Manual NEVER runs the router and never drafts", async () => {
    await run({ tenant: { ...tenant, engagementMode: "manual" } });

    expect(triageInbound).not.toHaveBeenCalled();
    expect(studentWhisper).not.toHaveBeenCalled();
    expect(studentFlashDraft).not.toHaveBeenCalled();

    const states = await readState();
    const live = states.filter(
      (s) => s.status === "drafted" || s.status === "auto_sent",
    );
    expect(live).toHaveLength(0);
  });
});
