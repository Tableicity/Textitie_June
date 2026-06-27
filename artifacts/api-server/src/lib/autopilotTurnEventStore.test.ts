import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  conversationsTable,
  autopilotTurnEventsTable,
} from "@workspace/db";
import {
  recordAutopilotTurnEvent,
  getAutopilotFallbackCounts,
} from "./autopilotTurnEventStore";
import type { AutopilotTurnOutcome } from "./engagementPolicy";

// DB-backed (real test DB, no @workspace/db mock): the idempotency claim and the
// fallback tallies are SQL behaviors, so we assert them against the real DB.

const RUN = `apevt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let tenantId = 0;
let conversationId = 0;

beforeAll(async () => {
  const [t] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: `AP ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: `+1975${String(Date.now()).slice(-7)}`,
    })
    .returning({ id: tenantsTable.id });
  tenantId = t.id;

  const [c] = await db
    .insert(conversationsTable)
    .values({
      tenantId,
      contactPhone: "+15551230000",
      status: "open",
    })
    .returning({ id: conversationsTable.id });
  conversationId = c.id;
});

beforeEach(async () => {
  await db
    .delete(autopilotTurnEventsTable)
    .where(eq(autopilotTurnEventsTable.tenantId, tenantId));
});

afterAll(async () => {
  if (tenantId) {
    await db
      .delete(autopilotTurnEventsTable)
      .where(eq(autopilotTurnEventsTable.tenantId, tenantId));
    await db
      .delete(conversationsTable)
      .where(eq(conversationsTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  }
});

// Insert with an explicit createdAt so the rolling-window tests are deterministic.
const insertEvent = (
  inboundMessageId: number,
  outcome: AutopilotTurnOutcome,
  createdAt: Date,
) =>
  db.insert(autopilotTurnEventsTable).values({
    tenantId,
    conversationId,
    inboundMessageId,
    outcome,
    createdAt,
  });

describe("recordAutopilotTurnEvent — idempotency", () => {
  it("records one row per inbound and no-ops on a retry", async () => {
    const first = await recordAutopilotTurnEvent({
      tenantId,
      conversationId,
      inboundMessageId: 1001,
      outcome: "fallback",
    });
    const second = await recordAutopilotTurnEvent({
      tenantId,
      conversationId,
      inboundMessageId: 1001,
      outcome: "fallback",
    });
    expect(first).toBe(true);
    expect(second).toBe(false);

    const rows = await db
      .select()
      .from(autopilotTurnEventsTable)
      .where(eq(autopilotTurnEventsTable.tenantId, tenantId));
    expect(rows).toHaveLength(1);
  });
});

describe("getAutopilotFallbackCounts", () => {
  it("counts consecutive fallbacks and resets on an answer", async () => {
    await recordAutopilotTurnEvent({
      tenantId,
      conversationId,
      inboundMessageId: 2001,
      outcome: "fallback",
    });
    await recordAutopilotTurnEvent({
      tenantId,
      conversationId,
      inboundMessageId: 2002,
      outcome: "fallback",
    });
    let counts = await getAutopilotFallbackCounts(tenantId, conversationId);
    expect(counts.consecutive).toBe(2);

    await recordAutopilotTurnEvent({
      tenantId,
      conversationId,
      inboundMessageId: 2003,
      outcome: "answer",
    });
    counts = await getAutopilotFallbackCounts(tenantId, conversationId);
    expect(counts.consecutive).toBe(0);
  });

  it("counts only fallbacks within the rolling 2-min window", async () => {
    const now = new Date("2026-06-27T12:00:00.000Z");
    await insertEvent(3001, "fallback", new Date(now.getTime() - 10_000));
    await insertEvent(3002, "fallback", new Date(now.getTime() - 200_000)); // outside 2 min
    const counts = await getAutopilotFallbackCounts(
      tenantId,
      conversationId,
      now,
    );
    expect(counts.inWindow).toBe(1);
    expect(counts.consecutive).toBe(2); // consecutive is not time-bound
  });

  it("treats a prior stepdown as a fresh-start boundary for both tallies", async () => {
    const now = new Date("2026-06-27T12:00:00.000Z");
    await insertEvent(4001, "fallback", new Date(now.getTime() - 60_000));
    await insertEvent(4002, "fallback", new Date(now.getTime() - 50_000));
    await insertEvent(
      4003,
      "stepdown_consecutive",
      new Date(now.getTime() - 40_000),
    );
    // Human re-enabled Auto-Pilot; a fresh fallback lands after the stepdown.
    await insertEvent(4004, "fallback", new Date(now.getTime() - 10_000));
    const counts = await getAutopilotFallbackCounts(
      tenantId,
      conversationId,
      now,
    );
    expect(counts.consecutive).toBe(1);
    expect(counts.inWindow).toBe(1);
  });

  it("ignores compliance_block when counting (neutral)", async () => {
    const now = new Date("2026-06-27T12:00:00.000Z");
    await insertEvent(5001, "fallback", new Date(now.getTime() - 30_000));
    await insertEvent(5002, "compliance_block", new Date(now.getTime() - 20_000));
    await insertEvent(5003, "fallback", new Date(now.getTime() - 10_000));
    const counts = await getAutopilotFallbackCounts(
      tenantId,
      conversationId,
      now,
    );
    expect(counts.consecutive).toBe(2);
    expect(counts.inWindow).toBe(2);
  });
});
