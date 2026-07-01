import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  contactsTable,
  conversationsTable,
  messagesTable,
  auditLogsTable,
  phoneNumbersTable,
} from "@workspace/db";

// Disable the Twilio signature gate for these tests: with TWILIO_AUTH_TOKEN
// unset, checkTwilioSignature() skips verification (the documented local/test
// path), so the simulated webhook is accepted as if Twilio had signed it.
delete process.env["TWILIO_AUTH_TOKEN"];

// Importing the app must happen after the env tweak above so the route picks up
// the unset token. The app object does not call listen() — index.ts does — so
// it is safe to drive with supertest.
const { default: app } = await import("../app");

// Unique-per-run identifiers so repeated CI runs never collide on the
// tenants.slug unique index or the contacts (tenant_id, phone) unique index.
const RUN = `blktest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TENANT_PHONE = `+1999${String(Date.now()).slice(-7)}`;
const BLOCKED_FROM = "+15550001111";
const ALLOWED_FROM = "+15550002222";

let tenantId: number;

async function conversationCountFor(phone: string): Promise<number> {
  const rows = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.contactPhone, phone),
      ),
    );
  return rows.length;
}

async function messageCountFor(phone: string): Promise<number> {
  const rows = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .innerJoin(
      conversationsTable,
      eq(messagesTable.conversationId, conversationsTable.id),
    )
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.contactPhone, phone),
      ),
    );
  return rows.length;
}

function postInbound(from: string, body: string) {
  return request(app)
    .post("/api/webhooks/twilio")
    .type("form")
    .send({ To: TENANT_PHONE, From: from, Body: body });
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 8000,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

beforeAll(async () => {
  const [tenant] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: "Block Enforcement Test Tenant",
      region: "us",
      tierCode: "starter",
      phoneNumber: TENANT_PHONE,
      subscriptionStatus: "active",
    })
    .returning({ id: tenantsTable.id });
  tenantId = tenant.id;

  // Seed the canonical routing row so resolveTenantByPhoneNumber() maps the
  // inbound `To` (TENANT_PHONE) to this tenant. The resolver reads ONLY the
  // phone_numbers table and fails CLOSED — it never falls back to
  // tenants.phone_number — so without this row every simulated inbound would be
  // recorded as unrouted and the block-enforcement branch would never run.
  // Cascades away when the tenant is deleted in afterAll (onDelete: 'cascade').
  await db.insert(phoneNumbersTable).values({
    phoneNumber: TENANT_PHONE,
    tenantId,
    kind: "primary",
  });

  // A blocked contact for BLOCKED_FROM; ALLOWED_FROM has no contact row yet
  // (the webhook auto-saves it on the happy path).
  await db.insert(contactsTable).values({
    tenantId,
    phone: BLOCKED_FROM,
    name: "Blocked Sender",
    blocked: true,
  });
});

afterAll(async () => {
  if (tenantId == null) return;
  // FK order: messages -> conversations -> (contacts, audit_logs) -> tenant.
  const convs = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(eq(conversationsTable.tenantId, tenantId));
  for (const c of convs) {
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, c.id));
  }
  await db
    .delete(conversationsTable)
    .where(eq(conversationsTable.tenantId, tenantId));
  await db.delete(contactsTable).where(eq(contactsTable.tenantId, tenantId));
  await db.delete(auditLogsTable).where(eq(auditLogsTable.tenantId, tenantId));
  // phone_numbers -> tenants FK is onDelete: "restrict", so clear the tenant's
  // numbers before deleting the tenant or teardown 23503s on the constraint.
  await db.delete(phoneNumbersTable).where(eq(phoneNumbersTable.tenantId, tenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("inbound block enforcement (webhooks/twilio)", () => {
  it("drops a text from a blocked number before it reaches the inbox", async () => {
    const res = await postInbound(BLOCKED_FROM, "let me in");
    expect(res.status).toBe(201);
    // The recorded webhook event is flagged as blocked, not routed.
    expect(res.body?.payload?._sama?.blocked).toBe(true);
    expect(res.body?.payload?._sama?.routed).toBe(false);

    // The blocked path is fully synchronous (it never enters the async inbox
    // pipeline), but wait briefly to prove no conversation/message appears
    // even if a stray async write were introduced by a future refactor.
    await new Promise((r) => setTimeout(r, 500));

    expect(await conversationCountFor(BLOCKED_FROM)).toBe(0);
    expect(await messageCountFor(BLOCKED_FROM)).toBe(0);

    // ...but the suppression is audited.
    const audits = await db
      .select({ id: auditLogsTable.id, entityId: auditLogsTable.entityId })
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.tenantId, tenantId),
          eq(auditLogsTable.action, "inbound.blocked"),
        ),
      );
    expect(audits.length).toBe(1);
    expect(audits[0].entityId).toBe(BLOCKED_FROM);
  });

  it("still creates a conversation for a non-blocked number on the same tenant", async () => {
    const res = await postInbound(ALLOWED_FROM, "hello there");
    expect(res.status).toBe(201);
    expect(res.body?.payload?._sama?.routed).toBe(true);
    expect(res.body?.payload?._sama?.blocked).toBeUndefined();

    // The inbox write path is fire-and-forget, so poll until it lands.
    const created = await waitFor(
      async () => (await conversationCountFor(ALLOWED_FROM)) > 0,
    );
    expect(created).toBe(true);
    expect(await messageCountFor(ALLOWED_FROM)).toBeGreaterThan(0);

    // The happy path must NOT write an inbound.blocked audit row.
    const blockedAudits = await db
      .select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.tenantId, tenantId),
          eq(auditLogsTable.action, "inbound.blocked"),
          eq(auditLogsTable.entityId, ALLOWED_FROM),
        ),
      );
    expect(blockedAudits.length).toBe(0);
  });
});
