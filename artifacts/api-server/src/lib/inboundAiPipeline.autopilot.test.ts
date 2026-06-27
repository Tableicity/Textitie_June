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
  autopilotTurnEventsTable,
  type Tenant,
} from "@workspace/db";
import { runInboundAiPipeline } from "./inboundAiPipeline";
import {
  studentWhisper,
  type StudentDraft,
} from "@workspace/ai-student";
import {
  retrieveClassroomFactsWithMatch,
  classifyQueryCategory,
  type FactCategory,
} from "./knowledge";
import { sendConversationReply } from "./outboundReply";
import { checkOutboundCompliance } from "./compliance";
import type { AutopilotTurnOutcome } from "./engagementPolicy";

// ---------------------------------------------------------------------------
// AUTO-PILOT closed-book fail-OPEN responder + fallback circuit breaker
// (DB-backed). The REAL database with real seeded rows; we mock ONLY the
// external seams (Student stitch, Classroom retrieval, SMS sender, compliance)
// so the assertions read REAL persisted ai-state, turn events, claims, and the
// engagement-mode override.
//
// This exercises the new Gate Table end-to-end via runInboundAiPipeline (which
// diverts every autopilot turn into runAutoPilotFailOpenTurn at the seam):
//   Row 0  compliance hold        → suppress; compliance_block event; NO send
//   Row 1  human stepped in       → defer; NO send; NO event
//   Row 2  knowledge match        → grounded Student answer; GREEN; answer event
//   Row 3  no match, breaker OK    → graceful ack; GREEN; fallback event
//   Row 4  3rd consecutive miss    → final ack + stepdown to BLUE (manual)
//   Row 5  >3 misses in 2 min      → final ack + stepdown to BLUE (manual)
//   Row 6  responder/LLM error     → graceful ack; error_fallback event
//   + idempotency (claim) and a failed send (claim released, NO breaker move).
//
// Invariants: closed-book (a MISS never calls the Student; NO Professor/Library/
// learning), fail-OPEN (always a reply unless compliance blocks), breaker only
// moves on a CONFIRMED send.
// ---------------------------------------------------------------------------

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
  };
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

const RUN = `aiautopilot-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const phone = `+1987${String(Date.now()).slice(-7)}`;
const BRAND_SCOPE = "We sell HVAC parts and supplies to licensed contractors.";
const HOLDING =
  "Thanks! A team member will follow up with you about that shortly.";
const OUTBOUND_ID = 991001;

// Built-in acks (the function falls back to these when no holding phrase set).
const DEFAULT_FALLBACK_ACK =
  "Thanks for your message! I don't have an answer for that just yet — let me look into it and follow up shortly.";
const DEFAULT_FINAL_ACK =
  "Thanks for your patience. I'm passing this to a member of our team who'll follow up with you directly.";

// A usable grounded answer the Student stitches from approved facts.
const GROUNDED_DRAFT: StudentDraft = {
  status: "drafted",
  whisperBody: "Answered from the Classroom.",
  detail: "ok",
  latencyMs: 5,
  draftReply: "We're open 9am to 5pm, Monday through Friday.",
  kbMatched: true,
  confidence: "high",
  groundedInClassroom: true,
};

// Student returned nothing usable → responder error (Row 6).
const EMPTY_DRAFT: StudentDraft = {
  status: "drafted",
  whisperBody: "",
  detail: "no draft",
  latencyMs: 5,
  draftReply: "",
  kbMatched: false,
  confidence: "low",
  groundedInClassroom: false,
};

const MATCH = {
  facts: [
    {
      statement: "We are open 9am to 5pm, Monday through Friday.",
      sourceLabel: "Hours FAQ",
      category: "general",
    },
  ],
  matchType: "fts",
  topRank: 0.6,
} as unknown as Awaited<ReturnType<typeof retrieveClassroomFactsWithMatch>>;

const NO_MATCH = {
  facts: [],
  matchType: "none",
  topRank: 0,
} as unknown as Awaited<ReturnType<typeof retrieveClassroomFactsWithMatch>>;

function sentOk(messageId: number) {
  return {
    ok: true,
    status: "sent",
    messageRow: { id: messageId },
    sendSummary: {},
  } as unknown as Awaited<ReturnType<typeof sendConversationReply>>;
}

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
      name: `AI autopilot ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: phone,
      engagementMode: "autopilot",
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

  // Defaults: a clean no-match turn that sends an ack. Each test overrides.
  vi.mocked(studentWhisper).mockResolvedValue(GROUNDED_DRAFT);
  vi.mocked(retrieveClassroomFactsWithMatch).mockResolvedValue(NO_MATCH);
  vi.mocked(classifyQueryCategory).mockReturnValue("general" as FactCategory);
  vi.mocked(checkOutboundCompliance).mockResolvedValue({
    ok: true,
  } as unknown as Awaited<ReturnType<typeof checkOutboundCompliance>>);
  vi.mocked(sendConversationReply).mockResolvedValue(sentOk(OUTBOUND_ID));

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      tenantId,
      contactPhone: `+1559${Math.floor(Math.random() * 1e7)}`,
      contactName: "Auto-Pilot Test",
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
    messageBody: "What time do you open?",
    fromNumber: "+15557654321",
    automationHandled: false,
    ...over,
  });
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

async function readState() {
  return db
    .select()
    .from(conversationAiStatesTable)
    .where(eq(conversationAiStatesTable.conversationId, conversationId));
}

async function readEvents() {
  return db
    .select()
    .from(autopilotTurnEventsTable)
    .where(eq(autopilotTurnEventsTable.conversationId, conversationId));
}

async function readClaims() {
  return db
    .select()
    .from(aiAutoRepliesTable)
    .where(eq(aiAutoRepliesTable.tenantId, tenantId));
}

async function readConversation() {
  const [row] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);
  return row;
}

// Seed a prior breaker event with an explicit age so the rolling-window and
// consecutive tallies are deterministic. Uses a unique inboundMessageId so the
// (tenant, inboundMessageId) idempotency key never collides with the live turn.
let seedSeq = 1;
async function seedEvent(outcome: AutopilotTurnOutcome, ageMs: number) {
  await db.insert(autopilotTurnEventsTable).values({
    tenantId,
    conversationId,
    inboundMessageId: -1 * seedSeq++,
    outcome,
    createdAt: new Date(Date.now() - ageMs),
  });
}

describe("runInboundAiPipeline — Auto-Pilot closed-book fail-OPEN gate", () => {
  it("Row 2 — knowledge match → grounded Student answer; GREEN (auto_sent); answer event", async () => {
    vi.mocked(retrieveClassroomFactsWithMatch).mockResolvedValue(MATCH);
    vi.mocked(studentWhisper).mockResolvedValue(GROUNDED_DRAFT);

    await run();

    expect(studentWhisper).toHaveBeenCalledTimes(1);
    expect(sendConversationReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendConversationReply).mock.calls[0][0].body).toBe(
      GROUNDED_DRAFT.draftReply,
    );

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("auto_sent");
    expect(states[0].outboundMessageId).toBe(OUTBOUND_ID);

    const events = await readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("answer");
    expect(events[0].outboundMessageId).toBe(OUTBOUND_ID);

    // Closed-book GREEN: conversation stays autopilot (no stepdown).
    const conv = await readConversation();
    expect(conv.engagementModeOverride).toBeNull();
  });

  it("Row 3 — no match, breaker OK → graceful ack; GREEN; fallback event; Student NOT called", async () => {
    await run();

    // Closed-book: a miss never invokes the Student.
    expect(studentWhisper).not.toHaveBeenCalled();
    expect(sendConversationReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendConversationReply).mock.calls[0][0].body).toBe(
      DEFAULT_FALLBACK_ACK,
    );

    const states = await readState();
    expect(states[0].status).toBe("auto_sent");

    const events = await readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("fallback");

    const conv = await readConversation();
    expect(conv.engagementModeOverride).toBeNull();
  });

  it("uses the configured autopilotHoldingPhrase as the ack when set", async () => {
    await run({ tenant: { ...tenant, autopilotHoldingPhrase: HOLDING } });

    expect(sendConversationReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendConversationReply).mock.calls[0][0].body).toBe(HOLDING);
  });

  it("Row 4 — 3rd consecutive miss → final ack + stepdown to BLUE (manual)", async () => {
    await seedEvent("fallback", 60_000);
    await seedEvent("fallback", 30_000);

    await run();

    expect(sendConversationReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendConversationReply).mock.calls[0][0].body).toBe(
      DEFAULT_FINAL_ACK,
    );

    const events = await readEvents();
    const live = events.find((e) => e.inboundMessageId === inboundMessageId);
    expect(live?.outcome).toBe("stepdown_consecutive");

    const states = await readState();
    expect(states[0].status).toBe("refused");
    expect(states[0].reasonText).toContain("Auto-Pilot paused");

    // Stepped down GREEN → BLUE for this conversation only.
    const conv = await readConversation();
    expect(conv.engagementModeOverride).toBe("manual");
  });

  it("Row 5 — >3 misses in the rolling 2-min window → stepdown to BLUE (manual)", async () => {
    // consecutive run is broken by an answer, so Row 4 does NOT fire; the
    // window still holds 3 prior misses, so this 4th trips Row 5.
    await seedEvent("fallback", 110_000);
    await seedEvent("fallback", 90_000);
    await seedEvent("answer", 70_000);
    await seedEvent("fallback", 40_000);

    await run();

    expect(sendConversationReply).toHaveBeenCalledTimes(1);

    const events = await readEvents();
    const live = events.find((e) => e.inboundMessageId === inboundMessageId);
    expect(live?.outcome).toBe("stepdown_window");

    const conv = await readConversation();
    expect(conv.engagementModeOverride).toBe("manual");
  });

  it("Row 6 — knowledge match but Student returns nothing → graceful ack; error_fallback event", async () => {
    vi.mocked(retrieveClassroomFactsWithMatch).mockResolvedValue(MATCH);
    vi.mocked(studentWhisper).mockResolvedValue(EMPTY_DRAFT);

    await run();

    expect(studentWhisper).toHaveBeenCalledTimes(1);
    expect(sendConversationReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendConversationReply).mock.calls[0][0].body).toBe(
      DEFAULT_FALLBACK_ACK,
    );

    const events = await readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("error_fallback");

    const states = await readState();
    expect(states[0].status).toBe("auto_sent");
  });

  it("Row 0 — compliance hold → suppress (no send); compliance_block event; breaker NOT moved", async () => {
    vi.mocked(checkOutboundCompliance).mockResolvedValue({
      ok: false,
      reason: "opted_out",
      message: "Recipient opted out",
    } as unknown as Awaited<ReturnType<typeof checkOutboundCompliance>>);

    await run();

    expect(sendConversationReply).not.toHaveBeenCalled();

    const events = await readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("compliance_block");

    // No claim taken (we never reached the send block).
    const claims = await readClaims();
    expect(claims).toHaveLength(0);

    const conv = await readConversation();
    expect(conv.engagementModeOverride).toBeNull();
  });

  it("Row 1 — a human already handled this turn → defer (no send, no event)", async () => {
    await db.insert(conversationAiStatesTable).values({
      tenantId,
      conversationId,
      status: "human_handled",
      latestInboundMessageId: inboundMessageId,
    });

    await run();

    expect(sendConversationReply).not.toHaveBeenCalled();
    expect(studentWhisper).not.toHaveBeenCalled();

    const events = await readEvents();
    expect(events).toHaveLength(0);

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("human_handled");
  });

  it("idempotency — a webhook retry of the same inbound does not double-send or double-count", async () => {
    await run();
    expect(sendConversationReply).toHaveBeenCalledTimes(1);

    // Same inboundSid → the ai_auto_replies claim short-circuits the retry.
    await run();
    expect(sendConversationReply).toHaveBeenCalledTimes(1);

    const events = await readEvents();
    expect(events).toHaveLength(1);
    const claims = await readClaims();
    expect(claims).toHaveLength(1);
  });

  it("send returns {ok:false} → claim released; Blue handback (failed); NO turn event (breaker not moved)", async () => {
    vi.mocked(sendConversationReply).mockResolvedValue({
      ok: false,
      reason: "twilio_error",
      errorMessage: "carrier rejected",
    } as unknown as Awaited<ReturnType<typeof sendConversationReply>>);

    await run();

    expect(sendConversationReply).toHaveBeenCalledTimes(1);

    const states = await readState();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("failed");
    expect(states[0].reasonCode).toBe("send_failed");

    // A delivery failure is NOT a knowledge miss → it must never move the breaker.
    const events = await readEvents();
    expect(events).toHaveLength(0);

    // Released so a webhook retry can re-attempt.
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
