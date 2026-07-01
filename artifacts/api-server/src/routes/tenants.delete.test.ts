import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  conversationsTable,
  messagesTable,
  conversationInboundAiStagesTable,
  conversationAiStatesTable,
  knowledgeDocumentsTable,
  aiAutoRepliesTable,
  migrationJobsTable,
  phoneNumbersTable,
} from "@workspace/db";

const { default: app } = await import("../app");

// Regression cover for the Conductor delete-tenant transaction. The tx removes
// `messages` FIRST and relies on ON DELETE CASCADE for every other tenant-scoped
// table. A prior gap left `conversation_inbound_ai_stages.inbound_message_id`
// (FK -> messages.id) with no cascade, so the very first `DELETE FROM messages`
// would raise an FK violation whenever a conversation had a staged AI turn — the
// conversation-level cascade never got a chance to fire. This exercises the real
// route with one row in each FK path (messages.id, conversations.id, tenants.id)
// and asserts the whole tenant graph is removed without an FK error.

const RUN = `tdel-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SLUG = RUN;
const PHONE = `+1994${String(Date.now()).slice(-7)}`;

let tenantId = 0;
let conversationId = 0;
let messageId = 0;

function asConductor(req: request.Test): request.Test {
  const pw = process.env["CONDUCTOR_PASSWORD"];
  return pw ? req.auth("conductor", pw) : req;
}

beforeAll(async () => {
  const [t] = await db
    .insert(tenantsTable)
    .values({ slug: SLUG, name: "Delete cascade", region: "us", tierCode: "starter" })
    .returning({ id: tenantsTable.id });
  tenantId = t.id;

  await db
    .insert(phoneNumbersTable)
    .values({ phoneNumber: PHONE, tenantId, kind: "primary" });

  const [c] = await db
    .insert(conversationsTable)
    .values({
      tenantId,
      contactPhone: PHONE,
      contactName: PHONE,
      status: "open",
      lastMessageAt: new Date(),
    })
    .returning({ id: conversationsTable.id });
  conversationId = c.id;

  const [m] = await db
    .insert(messagesTable)
    .values({ conversationId, direction: "inbound", body: "hello" })
    .returning({ id: messagesTable.id });
  messageId = m.id;

  // The row that previously blocked `DELETE FROM messages` (FK -> messages.id
  // with no cascade). This is the core regression under test.
  await db.insert(conversationInboundAiStagesTable).values({
    tenantId,
    conversationId,
    inboundMessageId: messageId,
    messageBody: "hello",
    fromNumber: PHONE,
  });

  // conversation_id cascade path (representative of the 4 AI tables).
  await db.insert(conversationAiStatesTable).values({ tenantId, conversationId });

  // tenant_id cascade paths.
  await db
    .insert(knowledgeDocumentsTable)
    .values({ tenantId, sourceType: "paste", title: "Doc", extractedText: "body" });
  await db.insert(aiAutoRepliesTable).values({ tenantId, inboundSid: `SM${RUN}` });
  await db.insert(migrationJobsTable).values({ tenantId });
});

afterAll(async () => {
  // Best-effort teardown only if the delete under test did not run (failure).
  // FK-safe order: messages (cascades stages) -> conversations (cascades AI
  // state) -> tenant (cascades phone_numbers / knowledge / auto-replies /
  // migrations). The successful delete path already removed everything.
  try {
    if (conversationId) {
      await db
        .delete(messagesTable)
        .where(eq(messagesTable.conversationId, conversationId));
      await db
        .delete(conversationsTable)
        .where(eq(conversationsTable.id, conversationId));
    }
    if (tenantId) {
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    }
  } catch {
    // ignore
  }
});

describe("DELETE /api/tenants/:id", () => {
  it("cascades the critical tenant-scoped child paths without an FK violation", async () => {
    const res = await asConductor(
      request(app).delete(`/api/tenants/${tenantId}`),
    ).send({ slug: SLUG });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);

    const gone = async (rows: Promise<unknown[]>) =>
      expect(await rows).toHaveLength(0);

    await gone(
      db
        .select({ id: tenantsTable.id })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId)),
    );
    await gone(
      db
        .select({ id: messagesTable.id })
        .from(messagesTable)
        .where(eq(messagesTable.id, messageId)),
    );
    await gone(
      db
        .select({ id: conversationInboundAiStagesTable.id })
        .from(conversationInboundAiStagesTable)
        .where(eq(conversationInboundAiStagesTable.tenantId, tenantId)),
    );
    await gone(
      db
        .select({ id: conversationAiStatesTable.id })
        .from(conversationAiStatesTable)
        .where(eq(conversationAiStatesTable.tenantId, tenantId)),
    );
    await gone(
      db
        .select({ id: knowledgeDocumentsTable.id })
        .from(knowledgeDocumentsTable)
        .where(eq(knowledgeDocumentsTable.tenantId, tenantId)),
    );
    await gone(
      db
        .select({ id: aiAutoRepliesTable.id })
        .from(aiAutoRepliesTable)
        .where(eq(aiAutoRepliesTable.tenantId, tenantId)),
    );
    await gone(
      db
        .select({ id: migrationJobsTable.id })
        .from(migrationJobsTable)
        .where(eq(migrationJobsTable.tenantId, tenantId)),
    );
    await gone(
      db
        .select({ phoneNumber: phoneNumbersTable.phoneNumber })
        .from(phoneNumbersTable)
        .where(eq(phoneNumbersTable.tenantId, tenantId)),
    );
  });
});
