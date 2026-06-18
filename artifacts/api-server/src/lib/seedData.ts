import {
  db,
  ensureTenantSchema,
  getTenantDb,
  getTenantPool,
  tiersTable,
  tenantsTable,
  departmentsTable,
  conversationsTable,
  messagesTable,
  billingEventsTable,
  automationRulesTable,
  messageTemplatesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

const TIER_PRICING = [
  {
    code: "starter",
    name: "Starter",
    description: "1 agent seat, shared 10DLC pool — for solo operators kicking the tires.",
    features: ["1 agent seat", "1 phone number", "1,000 SMS credits/mo", "Shared 10DLC pool", "Email support"],
    monthlyPriceCents: 13900,
    includedCredits: 1000,
    trialDays: 14,
    maxAgents: 3,
    maxPhoneNumbers: 1,
    stripePriceId: "price_1TjWT10tnuZQWyqKTmJxYYou",
  },
  {
    code: "growth",
    name: "Teams",
    description: "Dedicated local numbers, automation — for growing teams replacing Textline.",
    features: ["Up to 10 agents", "Up to 5 phone numbers", "5,000 SMS credits/mo", "Automation workflows", "Priority support"],
    monthlyPriceCents: 34900,
    includedCredits: 5000,
    trialDays: 14,
    maxAgents: 10,
    maxPhoneNumbers: 5,
    stripePriceId: "price_1TjWTB0tnuZQWyqKOoXRCb4A",
  },
  {
    code: "enterprise",
    name: "Enterprise",
    description: "Custom domains, RLS isolation, Sovereign Toggle for German residency, HIPAA eligibility.",
    features: ["Unlimited agents", "Unlimited phone numbers", "Custom SMS credits", "Custom domains", "HIPAA-eligible (BAA)", "SLA + dedicated CSM"],
    monthlyPriceCents: 0,
    includedCredits: 0,
    trialDays: 0,
    maxAgents: 0,
    maxPhoneNumbers: 0,
    hipaaEligible: true,
  },
];

const DEMO_TENANTS = [
  { slug: "acme", name: "ACME Corp", region: "US", tierCode: "starter", phoneNumber: "+14155550100" },
];

const DEMO_DEPARTMENTS = ["Customer Support", "Sales", "Marketing"];

interface DemoConversation {
  contactPhone: string;
  contactName: string;
  status: string;
  tags: string[];
  messages: { direction: string; body: string; senderName: string }[];
}

const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    contactPhone: "+14155551234",
    contactName: "Sarah Johnson",
    status: "open",
    tags: ["vip", "support"],
    messages: [
      { direction: "inbound", body: "Hi, I need help with my account settings", senderName: "Sarah Johnson" },
      { direction: "outbound", body: "Of course! What specifically do you need help with?", senderName: "ACME Agent" },
      { direction: "inbound", body: "I want to change my notification preferences", senderName: "Sarah Johnson" },
    ],
  },
  {
    contactPhone: "+14155555678",
    contactName: "Mike Chen",
    status: "open",
    tags: ["orders", "support"],
    messages: [
      { direction: "inbound", body: "When will my order ship?", senderName: "Mike Chen" },
      { direction: "outbound", body: "Let me check that for you. What is your order number?", senderName: "ACME Agent" },
      { direction: "inbound", body: "Order #12345", senderName: "Mike Chen" },
    ],
  },
  {
    contactPhone: "+14155559012",
    contactName: "Emily Davis",
    status: "closed",
    tags: ["resolved"],
    messages: [
      { direction: "inbound", body: "Thanks for the help!", senderName: "Emily Davis" },
      { direction: "outbound", body: "You are welcome! Feel free to reach out anytime.", senderName: "ACME Agent" },
    ],
  },
  {
    contactPhone: "+14155553456",
    contactName: "James Wilson",
    status: "open",
    tags: ["vip", "sales"],
    messages: [
      { direction: "inbound", body: "I'd like to upgrade my subscription plan", senderName: "James Wilson" },
      { direction: "outbound", body: "Great choice! Let me walk you through our available plans.", senderName: "Admin User" },
      { direction: "inbound", body: "What's included in the Growth plan?", senderName: "James Wilson" },
      { direction: "outbound", body: "The Growth plan includes 5,000 credits/month, up to 10 agents, 5 dedicated phone numbers, and priority support. It's $79/month.", senderName: "Admin User" },
      { direction: "inbound", body: "That sounds perfect for our team. How do I switch?", senderName: "James Wilson" },
    ],
  },
  {
    contactPhone: "+14155557890",
    contactName: "Lisa Park",
    status: "open",
    tags: ["sales", "prospect"],
    messages: [
      { direction: "inbound", body: "Hello! I saw your ad on Instagram and wanted to learn more", senderName: "Lisa Park" },
      { direction: "outbound", body: "Welcome Lisa! What product are you interested in?", senderName: "ACME Agent" },
      { direction: "inbound", body: "I'm looking for a messaging solution for my small business — about 5 employees", senderName: "Lisa Park" },
    ],
  },
  {
    contactPhone: "+14155552468",
    contactName: "Robert Martinez",
    status: "open",
    tags: ["enterprise", "support"],
    messages: [
      { direction: "inbound", body: "We've been having issues with message delivery to German numbers", senderName: "Robert Martinez" },
      { direction: "outbound", body: "I can help with that. Are you using our sovereign DE routing?", senderName: "Admin User" },
      { direction: "inbound", body: "No, we haven't set that up yet. How does it work?", senderName: "Robert Martinez" },
      { direction: "outbound", body: "With the Enterprise plan, you can enable the Sovereign Toggle which routes all messages through DE-resident infrastructure. This ensures GDPR compliance and better delivery rates to European numbers.", senderName: "Admin User" },
    ],
  },
];

const DEMO_AUTOMATIONS = [
  {
    type: "welcome_message",
    name: "Welcome New Contacts",
    enabled: true,
    triggerConfig: {},
    actionConfig: { replyBody: "Welcome to ACME Corp! How can we help you today? A team member will be with you shortly." },
    priority: 0,
  },
  {
    type: "keyword_reply",
    name: "Hours & Availability",
    enabled: true,
    triggerConfig: { keywords: ["hours", "open", "available", "schedule"], matchType: "contains" },
    actionConfig: { replyBody: "Our business hours are Monday–Friday, 9 AM – 6 PM EST. We typically respond within 15 minutes during business hours." },
    priority: 10,
  },
  {
    type: "keyword_reply",
    name: "Pricing Info",
    enabled: true,
    triggerConfig: { keywords: ["price", "pricing", "cost", "how much"], matchType: "contains" },
    actionConfig: { replyBody: "Thanks for your interest in pricing! Our plans start at $29/mo. Visit our website for full details, or I can connect you with our sales team." },
    priority: 20,
  },
  {
    type: "follow_up_timer",
    name: "24h Follow-up",
    enabled: true,
    triggerConfig: { inactiveHours: 24 },
    actionConfig: { replyBody: "Hi! Just checking in — is there anything else we can help you with?" },
    priority: 0,
  },
  {
    type: "auto_resolve",
    name: "Auto-close after 72h",
    enabled: true,
    triggerConfig: { inactiveHours: 72 },
    actionConfig: { replyBody: "This conversation has been closed due to inactivity. Feel free to message us anytime if you need help!" },
    priority: 0,
  },
  {
    type: "auto_unsubscribe",
    name: "TCPA Opt-out",
    enabled: true,
    triggerConfig: {},
    actionConfig: {},
    priority: -1,
  },
];

const DEMO_SHORTCUTS = [
  { name: "Greeting", shortcutKey: "/hello", body: "Hi there! Thanks for reaching out to ACME Corp. How can I help you today?", category: "General" },
  { name: "Transfer Notice", shortcutKey: "/transfer", body: "I'm going to transfer you to a specialist who can better assist you. One moment please!", category: "General" },
  { name: "Business Hours", shortcutKey: "/hours", body: "Our business hours are Monday–Friday, 9 AM – 6 PM EST. We typically respond within 15 minutes during business hours.", category: "Info" },
  { name: "Closing", shortcutKey: "/bye", body: "Thanks for contacting ACME Corp! Don't hesitate to reach out if you need anything else. Have a great day!", category: "General" },
  { name: "Escalation", shortcutKey: "/escalate", body: "I understand this is important. Let me escalate this to our senior team right away. You'll hear back within the hour.", category: "Support" },
  { name: "Order Status", shortcutKey: "/order", body: "I'd be happy to look into your order status. Could you please share your order number?", category: "Support" },
  { name: "Refund Policy", shortcutKey: "/refund", body: "Our refund policy allows returns within 30 days of purchase. Would you like me to initiate a refund for you?", category: "Support" },
];

async function seedTiers(): Promise<void> {
  for (const tier of TIER_PRICING) {
    const existing = await db
      .select({ id: tiersTable.id })
      .from(tiersTable)
      .where(eq(tiersTable.code, tier.code))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(tiersTable).values(tier);
      logger.info({ code: tier.code }, "Tier seeded");
    } else {
      await db
        .update(tiersTable)
        .set({
          description: tier.description,
          features: tier.features,
          hipaaEligible: tier.hipaaEligible ?? false,
          // Backfill the real Stripe price ID so production (which only
          // receives schema, not data, on publish) gets it on next boot.
          // Enterprise has no price; only set when defined.
          ...("stripePriceId" in tier && tier.stripePriceId
            ? { stripePriceId: tier.stripePriceId }
            : {}),
        })
        .where(eq(tiersTable.code, tier.code));
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

    // Idempotent: provision per-tenant schema (no-op if already exists).
    await ensureTenantSchema(tenant.slug);
  }
}

async function seedDepartmentsForAcme(tenantId: number): Promise<void> {
  const tdb = getTenantDb("acme");
  for (const name of DEMO_DEPARTMENTS) {
    const existing = await tdb
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.tenantId, tenantId), eq(departmentsTable.name, name)))
      .limit(1);

    if (existing.length === 0) {
      await tdb.insert(departmentsTable).values({ tenantId, name });
      logger.info({ name, tenantSlug: "acme" }, "Demo department seeded");
    }
  }
}

async function seedConversationsForAcme(tenantId: number): Promise<void> {
  const tdb = getTenantDb("acme");
  for (const conv of DEMO_CONVERSATIONS) {
    const existing = await tdb
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.contactPhone, conv.contactPhone)))
      .limit(1);

    if (existing.length > 0) continue;

    const now = new Date();
    const rows = await tdb
      .insert(conversationsTable)
      .values({
        tenantId,
        contactPhone: conv.contactPhone,
        contactName: conv.contactName,
        status: conv.status,
        tags: conv.tags,
        lastMessageAt: now,
      })
      .returning();

    const conversationId = rows[0].id;

    for (let i = 0; i < conv.messages.length; i++) {
      const msg = conv.messages[i];
      const msgTime = new Date(now.getTime() - (conv.messages.length - i) * 60000);
      await tdb.insert(messagesTable).values({
        conversationId,
        direction: msg.direction,
        body: msg.body,
        senderName: msg.senderName,
        read: msg.direction === "outbound",
        createdAt: msgTime,
      });
    }

    logger.info({ contactName: conv.contactName, tenantSlug: "acme" }, "Demo conversation seeded");
  }
}

async function seedBillingDemoForAcme(tenantId: number, status: string): Promise<void> {
  if (status !== "none") return;

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
      prepaidCredits: 5000,
      overageEnabled: false,
    })
    .where(eq(tenantsTable.id, tenantId));

  const tdb = getTenantDb("acme");
  const existingEvents = await tdb
    .select({ id: billingEventsTable.id })
    .from(billingEventsTable)
    .where(eq(billingEventsTable.tenantId, tenantId))
    .limit(1);

  if (existingEvents.length === 0) {
    await tdb.insert(billingEventsTable).values({
      tenantId,
      eventType: "trial_started",
      toTier: "starter",
      amountCents: 2900,
      metadata: JSON.stringify({ subscriptionId: "sub_stub_demo_acme", trialDays: 14 }),
    });
  }

  // Seed per-tenant usage_records using raw SQL (not in schema as drizzle table).
  const tpool = getTenantPool("acme");
  const msgCount = await tpool.query(
    `SELECT count(*)::int as cnt FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE c.tenant_id = $1 AND m.direction = 'outbound'`,
    [tenantId],
  );
  const outboundCount = msgCount.rows[0]?.cnt ?? 0;

  await tpool.query(
    `INSERT INTO usage_records (tenant_id, period_start, period_end, messages_sent, credits_used, credits_included, overage_credits, overage_amount_cents)
     VALUES ($1, $2, $3, $4, $4, 1000, 0, 0)
     ON CONFLICT (tenant_id, period_start) DO UPDATE SET messages_sent = $4, credits_used = $4`,
    [tenantId, periodStart, periodEnd, outboundCount],
  );

  logger.info({ tenantId }, "Billing demo data seeded");
}

async function seedCampaignCreditsForAcme(tenantId: number, prepaid: number | null): Promise<void> {
  if ((prepaid ?? 0) > 0) return;
  await db
    .update(tenantsTable)
    .set({ prepaidCredits: 5000, overageEnabled: false })
    .where(eq(tenantsTable.id, tenantId));
  logger.info({ tenantId, prepaidCredits: 5000 }, "Campaign prepaid credits seeded");
}

async function seedAutomationsForAcme(tenantId: number): Promise<void> {
  const tdb = getTenantDb("acme");
  for (const rule of DEMO_AUTOMATIONS) {
    const existing = await tdb
      .select({ id: automationRulesTable.id })
      .from(automationRulesTable)
      .where(and(eq(automationRulesTable.tenantId, tenantId), eq(automationRulesTable.name, rule.name)))
      .limit(1);

    if (existing.length > 0) continue;

    await tdb.insert(automationRulesTable).values({
      tenantId,
      type: rule.type,
      name: rule.name,
      enabled: rule.enabled,
      triggerConfig: rule.triggerConfig,
      actionConfig: rule.actionConfig,
      priority: rule.priority,
    });
    logger.info({ name: rule.name, type: rule.type }, "Demo automation rule seeded");
  }
}

async function seedShortcutsForAcme(tenantId: number): Promise<void> {
  const tdb = getTenantDb("acme");
  for (const tmpl of DEMO_SHORTCUTS) {
    const existing = await tdb
      .select({ id: messageTemplatesTable.id })
      .from(messageTemplatesTable)
      .where(and(eq(messageTemplatesTable.tenantId, tenantId), eq(messageTemplatesTable.shortcutKey, tmpl.shortcutKey)))
      .limit(1);

    if (existing.length > 0) continue;

    await tdb.insert(messageTemplatesTable).values({
      tenantId,
      name: tmpl.name,
      shortcutKey: tmpl.shortcutKey,
      body: tmpl.body,
      category: tmpl.category,
    });
    logger.info({ name: tmpl.name, shortcutKey: tmpl.shortcutKey }, "Demo shortcut seeded");
  }
}

export async function seedDemoData(missingTables: string[]): Promise<void> {
  const required = ["tiers", "tenants", "departments", "conversations", "messages", "billing_events", "usage_records", "campaigns", "campaign_messages"];
  const blocked = required.filter((t) => missingTables.includes(t));
  if (blocked.length > 0) {
    logger.warn({ blocked }, "Skipping demo seed — required tables missing");
    return;
  }

  try {
    await seedTiers();
    await seedTenants();

    // ACME-specific demo data — all per-tenant tables, written into tenant_acme schema.
    const acme = await db
      .select({
        id: tenantsTable.id,
        subscriptionStatus: tenantsTable.subscriptionStatus,
        prepaidCredits: tenantsTable.prepaidCredits,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, "acme"))
      .limit(1);

    if (acme.length === 0) {
      logger.warn("ACME tenant not found after seeding; skipping per-tenant demo data");
      return;
    }
    const acmeId = acme[0].id;

    await seedDepartmentsForAcme(acmeId);
    await seedConversationsForAcme(acmeId);
    await seedBillingDemoForAcme(acmeId, acme[0].subscriptionStatus);
    if (!missingTables.includes("automation_rules")) {
      await seedAutomationsForAcme(acmeId);
    }
    if (!missingTables.includes("message_templates")) {
      await seedShortcutsForAcme(acmeId);
    }
    if (!missingTables.includes("campaigns")) {
      await seedCampaignCreditsForAcme(acmeId, acme[0].prepaidCredits);
    }
    logger.info("Demo data seed complete");
  } catch (err) {
    logger.error({ err }, "Demo data seed failed (non-fatal)");
  }
}
