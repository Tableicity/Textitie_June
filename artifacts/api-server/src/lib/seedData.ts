import { db, tiersTable, tenantsTable, departmentsTable, conversationsTable, messagesTable, tenantUsersTable, billingEventsTable, usageRecordsTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

const TIER_PRICING = [
  {
    code: "starter",
    name: "Starter",
    description: "1 Agent, Shared 10DLC pool — for solo operators kicking the tires.",
    features: ["1 agent seat", "Shared 10DLC pool", "Email support"],
    monthlyPriceCents: 2900,
    includedCredits: 1000,
    trialDays: 14,
    maxAgents: 3,
    maxPhoneNumbers: 1,
  },
  {
    code: "growth",
    name: "Growth",
    description: "Dedicated local number, n8n automation — for growing teams replacing Textline.",
    features: ["Dedicated local number", "n8n automation workflows", "Multi-agent", "Priority support"],
    monthlyPriceCents: 7900,
    includedCredits: 5000,
    trialDays: 14,
    maxAgents: 10,
    maxPhoneNumbers: 5,
  },
  {
    code: "enterprise",
    name: "Enterprise",
    description: "Custom domains, RLS isolation, Sovereign Toggle for German residency.",
    features: ["Custom domains", "Row-level tenant isolation", "Sovereign Toggle (DE residency)", "SLA + dedicated CSM"],
    monthlyPriceCents: 19900,
    includedCredits: 0,
    trialDays: 14,
    maxAgents: 0,
    maxPhoneNumbers: 0,
  },
];

const DEMO_TENANTS = [
  { slug: "acme", name: "ACME Corp", region: "US", tierCode: "starter", phoneNumber: "+14155550100" },
  { slug: "orbital", name: "Orbital Logistics", region: "US", tierCode: "growth", phoneNumber: "+14155550200" },
  { slug: "helvetia", name: "Helvetia Privatbank", region: "DE", tierCode: "enterprise", phoneNumber: "+491701234567" },
];

const DEMO_DEPARTMENTS = [
  { tenantSlug: "acme", name: "Customer Support" },
  { tenantSlug: "acme", name: "Sales" },
  { tenantSlug: "acme", name: "Marketing" },
];

const DEMO_CONVERSATIONS = [
  {
    tenantSlug: "acme",
    contactPhone: "+14155551234",
    contactName: "Sarah Johnson",
    status: "open",
    messages: [
      { direction: "inbound", body: "Hi, I need help with my account settings", senderName: "Sarah Johnson" },
      { direction: "outbound", body: "Of course! What specifically do you need help with?", senderName: "ACME Agent" },
      { direction: "inbound", body: "I want to change my notification preferences", senderName: "Sarah Johnson" },
    ],
  },
  {
    tenantSlug: "acme",
    contactPhone: "+14155555678",
    contactName: "Mike Chen",
    status: "open",
    messages: [
      { direction: "inbound", body: "When will my order ship?", senderName: "Mike Chen" },
      { direction: "outbound", body: "Let me check that for you. What is your order number?", senderName: "ACME Agent" },
      { direction: "inbound", body: "Order #12345", senderName: "Mike Chen" },
    ],
  },
  {
    tenantSlug: "acme",
    contactPhone: "+14155559012",
    contactName: "Emily Davis",
    status: "closed",
    messages: [
      { direction: "inbound", body: "Thanks for the help!", senderName: "Emily Davis" },
      { direction: "outbound", body: "You are welcome! Feel free to reach out anytime.", senderName: "ACME Agent" },
    ],
  },
  {
    tenantSlug: "acme",
    contactPhone: "+14155553456",
    contactName: "James Wilson",
    status: "open",
    messages: [
      { direction: "inbound", body: "I'd like to upgrade my subscription plan", senderName: "James Wilson" },
      { direction: "outbound", body: "Great choice! Let me walk you through our available plans.", senderName: "Admin User" },
      { direction: "inbound", body: "What's included in the Growth plan?", senderName: "James Wilson" },
      { direction: "outbound", body: "The Growth plan includes 5,000 credits/month, up to 10 agents, 5 dedicated phone numbers, and priority support. It's $79/month.", senderName: "Admin User" },
      { direction: "inbound", body: "That sounds perfect for our team. How do I switch?", senderName: "James Wilson" },
    ],
  },
  {
    tenantSlug: "acme",
    contactPhone: "+14155557890",
    contactName: "Lisa Park",
    status: "open",
    messages: [
      { direction: "inbound", body: "Hello! I saw your ad on Instagram and wanted to learn more", senderName: "Lisa Park" },
      { direction: "outbound", body: "Welcome Lisa! What product are you interested in?", senderName: "ACME Agent" },
      { direction: "inbound", body: "I'm looking for a messaging solution for my small business — about 5 employees", senderName: "Lisa Park" },
    ],
  },
  {
    tenantSlug: "acme",
    contactPhone: "+14155552468",
    contactName: "Robert Martinez",
    status: "open",
    messages: [
      { direction: "inbound", body: "We've been having issues with message delivery to German numbers", senderName: "Robert Martinez" },
      { direction: "outbound", body: "I can help with that. Are you using our sovereign DE routing?", senderName: "Admin User" },
      { direction: "inbound", body: "No, we haven't set that up yet. How does it work?", senderName: "Robert Martinez" },
      { direction: "outbound", body: "With the Enterprise plan, you can enable the Sovereign Toggle which routes all messages through DE-resident infrastructure. This ensures GDPR compliance and better delivery rates to European numbers.", senderName: "Admin User" },
    ],
  },
];

async function seedTiers(): Promise<void> {
  for (const tier of TIER_PRICING) {
    const existing = await db
      .select({ id: tiersTable.id, monthlyPriceCents: tiersTable.monthlyPriceCents })
      .from(tiersTable)
      .where(eq(tiersTable.code, tier.code))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(tiersTable).values(tier);
      logger.info({ code: tier.code }, "Tier seeded");
    } else if (existing[0].monthlyPriceCents === 0) {
      await db
        .update(tiersTable)
        .set({
          name: tier.name,
          description: tier.description,
          features: tier.features,
          monthlyPriceCents: tier.monthlyPriceCents,
          includedCredits: tier.includedCredits,
          trialDays: tier.trialDays,
          maxAgents: tier.maxAgents,
          maxPhoneNumbers: tier.maxPhoneNumbers,
        })
        .where(eq(tiersTable.code, tier.code));
      logger.info({ code: tier.code }, "Tier pricing updated");
    }
  }
}

async function seedTenants(): Promise<void> {
  for (const tenant of DEMO_TENANTS) {
    const existing = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, tenant.slug))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(tenantsTable).values(tenant);
      logger.info({ slug: tenant.slug }, "Demo tenant seeded");
    }
  }
}

async function seedDepartments(): Promise<void> {
  for (const dept of DEMO_DEPARTMENTS) {
    const tenants = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, dept.tenantSlug))
      .limit(1);

    if (tenants.length === 0) continue;
    const tenantId = tenants[0].id;

    const existing = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(eq(departmentsTable.name, dept.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(departmentsTable).values({ tenantId, name: dept.name });
      logger.info({ name: dept.name }, "Demo department seeded");
    }
  }
}

async function seedConversations(): Promise<void> {
  for (const conv of DEMO_CONVERSATIONS) {
    const tenants = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, conv.tenantSlug))
      .limit(1);

    if (tenants.length === 0) continue;
    const tenantId = tenants[0].id;

    const existing = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(eq(conversationsTable.contactPhone, conv.contactPhone))
      .limit(1);

    if (existing.length > 0) continue;

    const now = new Date();
    const rows = await db
      .insert(conversationsTable)
      .values({
        tenantId,
        contactPhone: conv.contactPhone,
        contactName: conv.contactName,
        status: conv.status,
        lastMessageAt: now,
      })
      .returning();

    const conversationId = rows[0].id;

    for (let i = 0; i < conv.messages.length; i++) {
      const msg = conv.messages[i];
      const msgTime = new Date(now.getTime() - (conv.messages.length - i) * 60000);
      await pool.query(
        `INSERT INTO messages (conversation_id, direction, body, sender_name, read, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [conversationId, msg.direction, msg.body, msg.senderName, msg.direction === "outbound", msgTime],
      );
    }

    logger.info({ contactName: conv.contactName }, "Demo conversation seeded");
  }
}

async function seedBillingDemo(): Promise<void> {
  const tenants = await db
    .select({ id: tenantsTable.id, subscriptionStatus: tenantsTable.subscriptionStatus, planTierCode: tenantsTable.planTierCode })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, "acme"))
    .limit(1);

  if (tenants.length === 0) return;
  const tenant = tenants[0];

  if (tenant.subscriptionStatus !== "none") return;

  const now = new Date();
  const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  await db
    .update(tenantsTable)
    .set({
      stripeCustomerId: "cus_stub_demo_acme",
      stripeSubscriptionId: "sub_stub_demo_acme",
      subscriptionStatus: "trialing",
      planTierCode: "starter",
      trialEndsAt: trialEnd,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    })
    .where(eq(tenantsTable.id, tenant.id));

  const existingEvents = await db
    .select({ id: billingEventsTable.id })
    .from(billingEventsTable)
    .where(eq(billingEventsTable.tenantId, tenant.id))
    .limit(1);

  if (existingEvents.length === 0) {
    await db.insert(billingEventsTable).values({
      tenantId: tenant.id,
      eventType: "trial_started",
      toTier: "starter",
      amountCents: 2900,
      metadata: JSON.stringify({ subscriptionId: "sub_stub_demo_acme", trialDays: 14 }),
    });
  }

  const msgCount = await pool.query(
    `SELECT count(*)::int as cnt FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE c.tenant_id = $1 AND m.direction = 'outbound'`,
    [tenant.id],
  );
  const outboundCount = msgCount.rows[0]?.cnt ?? 0;

  await pool.query(
    `INSERT INTO usage_records (tenant_id, period_start, period_end, messages_sent, credits_used, credits_included, overage_credits, overage_amount_cents)
     VALUES ($1, $2, $3, $4, $4, 1000, 0, 0)
     ON CONFLICT (tenant_id, period_start) DO UPDATE SET messages_sent = $4, credits_used = $4`,
    [tenant.id, periodStart, periodEnd, outboundCount],
  );

  logger.info({ tenantId: tenant.id }, "Billing demo data seeded");
}

export async function seedDemoData(missingTables: string[]): Promise<void> {
  const required = ["tiers", "tenants", "departments", "conversations", "messages", "billing_events", "usage_records"];
  const blocked = required.filter((t) => missingTables.includes(t));
  if (blocked.length > 0) {
    logger.warn({ blocked }, "Skipping demo seed — required tables missing");
    return;
  }

  try {
    await seedTiers();
    await seedTenants();
    await seedDepartments();
    await seedConversations();
    await seedBillingDemo();
    logger.info("Demo data seed complete");
  } catch (err) {
    logger.error({ err }, "Demo data seed failed (non-fatal)");
  }
}
