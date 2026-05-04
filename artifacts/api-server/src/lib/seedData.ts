import { db, tiersTable, tenantsTable, departmentsTable, conversationsTable, messagesTable, tenantUsersTable, billingEventsTable, usageRecordsTable, automationRulesTable, messageTemplatesTable, campaignsTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
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
    description: "Custom domains, RLS isolation, Sovereign Toggle for German residency, HIPAA eligibility.",
    features: ["Custom domains", "Row-level tenant isolation", "Sovereign Toggle (DE residency)", "SLA + dedicated CSM", "HIPAA-eligible (BAA)"],
    monthlyPriceCents: 19900,
    includedCredits: 0,
    trialDays: 14,
    maxAgents: 0,
    maxPhoneNumbers: 0,
    hipaaEligible: true,
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
    tags: ["vip", "support"],
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
    tags: ["orders", "support"],
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
    tags: ["resolved"],
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
    tenantSlug: "acme",
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
    tenantSlug: "acme",
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
    } else {
      await db
        .update(tiersTable)
        .set({
          description: tier.description,
          features: tier.features,
          hipaaEligible: tier.hipaaEligible ?? false,
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
        tags: conv.tags ?? [],
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
      prepaidCredits: 5000,
      overageEnabled: false,
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

async function seedCampaignCredits(): Promise<void> {
  const tenants = await db
    .select({ id: tenantsTable.id, prepaidCredits: tenantsTable.prepaidCredits })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, "acme"))
    .limit(1);

  if (tenants.length === 0) return;
  const tenant = tenants[0];

  if ((tenant.prepaidCredits ?? 0) > 0) return;

  await db
    .update(tenantsTable)
    .set({ prepaidCredits: 5000, overageEnabled: false })
    .where(eq(tenantsTable.id, tenant.id));

  logger.info({ tenantId: tenant.id, prepaidCredits: 5000 }, "Campaign prepaid credits seeded");
}

async function seedConversationTags(): Promise<void> {
  const tenants = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, "acme"))
    .limit(1);

  if (tenants.length === 0) return;
  const tenantId = tenants[0].id;

  const tagMap: Record<string, string[]> = {
    "+14155551234": ["vip", "support"],
    "+14155555678": ["orders", "support"],
    "+14155559012": ["resolved"],
    "+14155553456": ["vip", "sales"],
    "+14155557890": ["sales", "prospect"],
    "+14155552468": ["enterprise", "support"],
  };

  for (const [phone, tags] of Object.entries(tagMap)) {
    const conv = await db
      .select({ id: conversationsTable.id, tags: conversationsTable.tags })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.contactPhone, phone)))
      .limit(1);

    if (conv.length === 0) continue;
    if (conv[0].tags && conv[0].tags.length > 0) continue;

    await db
      .update(conversationsTable)
      .set({ tags })
      .where(eq(conversationsTable.id, conv[0].id));
  }

  logger.info("Conversation tags seeded for ACME");
}

const DEMO_AUTOMATIONS = [
  {
    tenantSlug: "acme",
    type: "welcome_message",
    name: "Welcome New Contacts",
    enabled: true,
    triggerConfig: {},
    actionConfig: { replyBody: "Welcome to ACME Corp! How can we help you today? A team member will be with you shortly." },
    priority: 0,
  },
  {
    tenantSlug: "acme",
    type: "keyword_reply",
    name: "Hours & Availability",
    enabled: true,
    triggerConfig: { keywords: ["hours", "open", "available", "schedule"], matchType: "contains" },
    actionConfig: { replyBody: "Our business hours are Monday–Friday, 9 AM – 6 PM EST. We typically respond within 15 minutes during business hours." },
    priority: 10,
  },
  {
    tenantSlug: "acme",
    type: "keyword_reply",
    name: "Pricing Info",
    enabled: true,
    triggerConfig: { keywords: ["price", "pricing", "cost", "how much"], matchType: "contains" },
    actionConfig: { replyBody: "Thanks for your interest in pricing! Our plans start at $29/mo. Visit our website for full details, or I can connect you with our sales team." },
    priority: 20,
  },
  {
    tenantSlug: "acme",
    type: "follow_up_timer",
    name: "24h Follow-up",
    enabled: true,
    triggerConfig: { inactiveHours: 24 },
    actionConfig: { replyBody: "Hi! Just checking in — is there anything else we can help you with?" },
    priority: 0,
  },
  {
    tenantSlug: "acme",
    type: "auto_resolve",
    name: "Auto-close after 72h",
    enabled: true,
    triggerConfig: { inactiveHours: 72 },
    actionConfig: { replyBody: "This conversation has been closed due to inactivity. Feel free to message us anytime if you need help!" },
    priority: 0,
  },
  {
    tenantSlug: "acme",
    type: "auto_unsubscribe",
    name: "TCPA Opt-out",
    enabled: true,
    triggerConfig: {},
    actionConfig: {},
    priority: -1,
  },
];

const DEMO_SHORTCUTS = [
  { tenantSlug: "acme", name: "Greeting", shortcutKey: "/hello", body: "Hi there! Thanks for reaching out to ACME Corp. How can I help you today?", category: "General" },
  { tenantSlug: "acme", name: "Transfer Notice", shortcutKey: "/transfer", body: "I'm going to transfer you to a specialist who can better assist you. One moment please!", category: "General" },
  { tenantSlug: "acme", name: "Business Hours", shortcutKey: "/hours", body: "Our business hours are Monday–Friday, 9 AM – 6 PM EST. We typically respond within 15 minutes during business hours.", category: "Info" },
  { tenantSlug: "acme", name: "Closing", shortcutKey: "/bye", body: "Thanks for contacting ACME Corp! Don't hesitate to reach out if you need anything else. Have a great day!", category: "General" },
  { tenantSlug: "acme", name: "Escalation", shortcutKey: "/escalate", body: "I understand this is important. Let me escalate this to our senior team right away. You'll hear back within the hour.", category: "Support" },
  { tenantSlug: "acme", name: "Order Status", shortcutKey: "/order", body: "I'd be happy to look into your order status. Could you please share your order number?", category: "Support" },
  { tenantSlug: "acme", name: "Refund Policy", shortcutKey: "/refund", body: "Our refund policy allows returns within 30 days of purchase. Would you like me to initiate a refund for you?", category: "Support" },
];

async function seedAutomations(): Promise<void> {
  for (const rule of DEMO_AUTOMATIONS) {
    const tenants = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, rule.tenantSlug))
      .limit(1);

    if (tenants.length === 0) continue;
    const tenantId = tenants[0].id;

    const existing = await db
      .select({ id: automationRulesTable.id })
      .from(automationRulesTable)
      .where(and(eq(automationRulesTable.tenantId, tenantId), eq(automationRulesTable.name, rule.name)))
      .limit(1);

    if (existing.length > 0) continue;

    await db.insert(automationRulesTable).values({
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

async function seedShortcuts(): Promise<void> {
  for (const tmpl of DEMO_SHORTCUTS) {
    const tenants = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, tmpl.tenantSlug))
      .limit(1);

    if (tenants.length === 0) continue;
    const tenantId = tenants[0].id;

    const existing = await db
      .select({ id: messageTemplatesTable.id })
      .from(messageTemplatesTable)
      .where(and(eq(messageTemplatesTable.tenantId, tenantId), eq(messageTemplatesTable.shortcutKey, tmpl.shortcutKey)))
      .limit(1);

    if (existing.length > 0) continue;

    await db.insert(messageTemplatesTable).values({
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
    await seedDepartments();
    await seedConversations();
    await seedBillingDemo();
    if (!missingTables.includes("automation_rules")) {
      await seedAutomations();
    }
    if (!missingTables.includes("message_templates")) {
      await seedShortcuts();
    }
    if (!missingTables.includes("campaigns")) {
      await seedCampaignCredits();
      await seedConversationTags();
    }
    logger.info("Demo data seed complete");
  } catch (err) {
    logger.error({ err }, "Demo data seed failed (non-fatal)");
  }
}
