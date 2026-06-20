import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  conversationsTable,
  conversationAiStatesTable,
  messagesTable,
  auditLogsTable,
  optOutsTable,
  phoneNumbersTable,
} from "@workspace/db";

// The human-send path only marks the AI state human_handled AFTER a confirmed
// "sent". The default StubSender returns "stubbed" (→ failed), so force a sender
// that reports a successful send. We assert the ROUTE WIRING (state flips), not
// carrier behavior.
vi.mock("../lib/senders", () => ({
  getSender: () => ({
    name: "test",
    send: async () => ({
      status: "sent",
      externalId: "TESTSID0001",
      responseSummary: "ok",
    }),
  }),
}));

const { default: app } = await import("../app");
const { signToken } = await import("./auth");

const RUN = `convengtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

type Tenant = { id: number; slug: string; phone: string; mode: string };
const tA: Tenant = { id: 0, slug: `${RUN}-a`, phone: `+1981${String(Date.now()).slice(-7)}`, mode: "autopilot" };
const tB: Tenant = { id: 0, slug: `${RUN}-b`, phone: `+1982${String(Date.now()).slice(-7)}`, mode: "copilot" };

function tokenFor(t: Tenant): string {
  return signToken({
    tenantUserId: 999000 + t.id,
    tenantId: t.id,
    tenantSlug: t.slug,
    email: `agent@${t.slug}.dev`,
    role: "owner",
    scope: "tenant",
  });
}

async function makeConversation(
  tenantId: number,
  phone: string,
  override: string | null = null,
): Promise<number> {
  const [row] = await db
    .insert(conversationsTable)
    .values({
      tenantId,
      contactPhone: phone,
      contactName: phone,
      status: "open",
      engagementModeOverride: override,
      lastMessageAt: new Date(),
    })
    .returning({ id: conversationsTable.id });
  return row.id;
}

async function aiStateFor(conversationId: number) {
  const rows = await db
    .select()
    .from(conversationAiStatesTable)
    .where(eq(conversationAiStatesTable.conversationId, conversationId))
    .limit(1);
  return rows[0] ?? null;
}

beforeAll(async () => {
  for (const t of [tA, tB]) {
    const [row] = await db
      .insert(tenantsTable)
      .values({
        slug: t.slug,
        name: `Conv engagement ${t.slug}`,
        region: "us",
        tierCode: "starter",
        phoneNumber: t.phone,
        engagementMode: t.mode,
      })
      .returning({ id: tenantsTable.id });
    t.id = row.id;
    await db
      .insert(phoneNumbersTable)
      .values({ phoneNumber: t.phone, tenantId: t.id, kind: "primary" });
  }
});

afterAll(async () => {
  for (const t of [tA, tB]) {
    if (!t.id) continue;
    const convs = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(eq(conversationsTable.tenantId, t.id));
    for (const c of convs) {
      await db
        .delete(conversationAiStatesTable)
        .where(eq(conversationAiStatesTable.conversationId, c.id));
      await db.delete(messagesTable).where(eq(messagesTable.conversationId, c.id));
    }
    await db.delete(conversationsTable).where(eq(conversationsTable.tenantId, t.id));
    await db.delete(optOutsTable).where(eq(optOutsTable.tenantId, t.id));
    await db.delete(auditLogsTable).where(eq(auditLogsTable.tenantId, t.id));
    await db.delete(phoneNumbersTable).where(eq(phoneNumbersTable.tenantId, t.id));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, t.id));
  }
});

describe("Conversations API — engagement mode + AI state (M4)", () => {
  it("GET detail exposes effectiveEngagementMode (tenant default) and aiState", async () => {
    const convId = await makeConversation(tA.id, "+15557770001");
    await db.insert(conversationAiStatesTable).values({
      tenantId: tA.id,
      conversationId: convId,
      status: "drafted",
      draftBody: "Hi! Here is a draft.",
      draftSource: "student",
      confidence: "high",
    });

    const res = await request(app)
      .get(`/api/conversations/${convId}`)
      .set("authorization", `Bearer ${tokenFor(tA)}`);

    expect(res.status).toBe(200);
    expect(res.body.engagementModeOverride).toBeNull();
    expect(res.body.effectiveEngagementMode).toBe("autopilot");
    expect(res.body.aiState).not.toBeNull();
    expect(res.body.aiState.status).toBe("drafted");
    expect(res.body.aiState.draftBody).toBe("Hi! Here is a draft.");
    expect(res.body.aiState.draftSource).toBe("student");
  });

  it("GET list enriches every row with effectiveEngagementMode + aiState", async () => {
    const res = await request(app)
      .get(`/api/conversations`)
      .set("authorization", `Bearer ${tokenFor(tA)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const row of res.body) {
      expect(row).toHaveProperty("effectiveEngagementMode");
      expect(row).toHaveProperty("aiState");
      expect(["manual", "copilot", "autopilot"]).toContain(
        row.effectiveEngagementMode,
      );
    }
  });

  it("PATCH override 'manual' wins over the autopilot tenant default", async () => {
    const convId = await makeConversation(tA.id, "+15557770002");
    const res = await request(app)
      .patch(`/api/conversations/${convId}`)
      .set("authorization", `Bearer ${tokenFor(tA)}`)
      .send({ engagementModeOverride: "manual" });

    expect(res.status).toBe(200);
    expect(res.body.engagementModeOverride).toBe("manual");
    expect(res.body.effectiveEngagementMode).toBe("manual");
  });

  it("PATCH override null clears it → effective falls back to tenant default", async () => {
    const convId = await makeConversation(tA.id, "+15557770003", "manual");
    const res = await request(app)
      .patch(`/api/conversations/${convId}`)
      .set("authorization", `Bearer ${tokenFor(tA)}`)
      .send({ engagementModeOverride: null });

    expect(res.status).toBe(200);
    expect(res.body.engagementModeOverride).toBeNull();
    expect(res.body.effectiveEngagementMode).toBe("autopilot");
  });

  it("PATCH rejects an invalid engagementModeOverride with 400", async () => {
    const convId = await makeConversation(tA.id, "+15557770004");
    const res = await request(app)
      .patch(`/api/conversations/${convId}`)
      .set("authorization", `Bearer ${tokenFor(tA)}`)
      .send({ engagementModeOverride: "turbo" });
    expect(res.status).toBe(400);

    // unchanged in the DB
    const rows = await db
      .select({ ov: conversationsTable.engagementModeOverride })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convId))
      .limit(1);
    expect(rows[0].ov).toBeNull();
  });

  it("PATCH is tenant-scoped: tenant A cannot override tenant B's conversation", async () => {
    const convB = await makeConversation(tB.id, "+15557770005");
    const res = await request(app)
      .patch(`/api/conversations/${convB}`)
      .set("authorization", `Bearer ${tokenFor(tA)}`)
      .send({ engagementModeOverride: "manual" });
    expect(res.status).toBe(404);

    // tenant B's row is untouched
    const rows = await db
      .select({ ov: conversationsTable.engagementModeOverride })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convB))
      .limit(1);
    expect(rows[0].ov).toBeNull();
  });

  it("human send flips a 'drafted' AI state to human_handled (learning suppressed)", async () => {
    const convId = await makeConversation(tA.id, "+15557770006");
    await db.insert(conversationAiStatesTable).values({
      tenantId: tA.id,
      conversationId: convId,
      status: "drafted",
      draftBody: "AI suggested this",
      draftSource: "student",
    });

    const res = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set("authorization", `Bearer ${tokenFor(tA)}`)
      .send({ body: "A human typed and sent this" });

    expect(res.status).toBe(201);

    const st = await aiStateFor(convId);
    expect(st?.status).toBe("human_handled");
    expect(st?.draftBody).toBeNull();
    expect(st?.humanHandledAt).not.toBeNull();
  });

  it("human send leaves an 'auto_sent' AI state untouched (it was a fresh turn)", async () => {
    const convId = await makeConversation(tA.id, "+15557770007");
    await db.insert(conversationAiStatesTable).values({
      tenantId: tA.id,
      conversationId: convId,
      status: "auto_sent",
      draftBody: null,
      autoSentAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set("authorization", `Bearer ${tokenFor(tA)}`)
      .send({ body: "human follow-up after an auto-send" });

    expect(res.status).toBe(201);
    const st = await aiStateFor(convId);
    expect(st?.status).toBe("auto_sent");
  });
});
