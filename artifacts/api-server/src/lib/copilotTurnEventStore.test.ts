import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  conversationsTable,
  copilotTurnEventsTable,
} from "@workspace/db";
import { recordCopilotTurnEvent } from "./copilotTurnEventStore";

// DB-backed (real test DB, no @workspace/db mock): the idempotency claim and the
// grounded/draftSource persistence are SQL behaviors, so we assert them against
// the real DB. Mirrors autopilotTurnEventStore.test.ts.

const RUN = `cpevt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let tenantId = 0;
let conversationId = 0;

beforeAll(async () => {
  const [t] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: `CP ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: `+1976${String(Date.now()).slice(-7)}`,
    })
    .returning({ id: tenantsTable.id });
  tenantId = t.id;

  const [c] = await db
    .insert(conversationsTable)
    .values({
      tenantId,
      contactPhone: "+15551231111",
      status: "open",
    })
    .returning({ id: conversationsTable.id });
  conversationId = c.id;
});

beforeEach(async () => {
  await db
    .delete(copilotTurnEventsTable)
    .where(eq(copilotTurnEventsTable.tenantId, tenantId));
});

afterAll(async () => {
  if (tenantId) {
    await db
      .delete(copilotTurnEventsTable)
      .where(eq(copilotTurnEventsTable.tenantId, tenantId));
    await db
      .delete(conversationsTable)
      .where(eq(conversationsTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  }
});

describe("recordCopilotTurnEvent — idempotency", () => {
  it("records one row per inbound and no-ops on a carrier retry", async () => {
    const first = await recordCopilotTurnEvent({
      tenantId,
      conversationId,
      inboundMessageId: 7001,
      draftSource: "student",
      grounded: true,
      staged: true,
    });
    const second = await recordCopilotTurnEvent({
      tenantId,
      conversationId,
      inboundMessageId: 7001,
      draftSource: "student",
      grounded: true,
      staged: true,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);

    const rows = await db
      .select()
      .from(copilotTurnEventsTable)
      .where(eq(copilotTurnEventsTable.tenantId, tenantId));
    expect(rows).toHaveLength(1);
  });
});

describe("recordCopilotTurnEvent — persists the knowledge/Grok signal", () => {
  it("stores grounded + draftSource per turn (knowledge vs raced-to-Grok)", async () => {
    // Answered using Knowledge.
    await recordCopilotTurnEvent({
      tenantId,
      conversationId,
      inboundMessageId: 8001,
      draftSource: "student",
      grounded: true,
      staged: true,
      queryCategory: "pricing",
    });
    // Raced to Grok (ungrounded general-knowledge flash draft).
    await recordCopilotTurnEvent({
      tenantId,
      conversationId,
      inboundMessageId: 8002,
      draftSource: "student_flash",
      grounded: false,
      staged: true,
    });
    // An ungrounded "student" draft (no fallback phrase) — still NOT knowledge.
    await recordCopilotTurnEvent({
      tenantId,
      conversationId,
      inboundMessageId: 8003,
      draftSource: "student",
      grounded: false,
      staged: false,
    });

    const rows = await db
      .select()
      .from(copilotTurnEventsTable)
      .where(eq(copilotTurnEventsTable.tenantId, tenantId));

    const grounded = rows.filter((r) => r.grounded);
    expect(grounded).toHaveLength(1);
    expect(grounded[0].inboundMessageId).toBe(8001);
    expect(grounded[0].queryCategory).toBe("pricing");

    // "Raced to Grok" = ungrounded student/student_flash drafts.
    const racedToGrok = rows.filter(
      (r) =>
        !r.grounded &&
        (r.draftSource === "student" || r.draftSource === "student_flash"),
    );
    expect(racedToGrok).toHaveLength(2);

    const ungroundedStudent = rows.find(
      (r) => r.inboundMessageId === 8003,
    );
    expect(ungroundedStudent?.draftSource).toBe("student");
    expect(ungroundedStudent?.grounded).toBe(false);
    expect(ungroundedStudent?.staged).toBe(false);
  });
});
