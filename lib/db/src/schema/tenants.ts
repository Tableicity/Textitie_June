import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  tierCode: text("tier_code").notNull(),
  sovereignToggle: boolean("sovereign_toggle").notNull().default(false),
  phoneNumber: text("phone_number"),
  chatwootAccountId: integer("chatwoot_account_id"),
  chatwootInboxId: integer("chatwoot_inbox_id"),
  knowledgeBase: text("knowledge_base"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status").notNull().default("none"),
  planTierCode: text("plan_tier_code"),
  trialUsed: boolean("trial_used").notNull().default(false),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  prepaidCredits: integer("prepaid_credits").notNull().default(0),
  overageEnabled: boolean("overage_enabled").notNull().default(false),
  quietHoursStart: integer("quiet_hours_start"),
  quietHoursEnd: integer("quiet_hours_end"),
  quietHoursTz: text("quiet_hours_tz").notNull().default("America/New_York"),
  frequencyCapPerDay: integer("frequency_cap_per_day").notNull().default(0),
  requireDoubleOptIn: boolean("require_double_opt_in").notNull().default(false),
  hipaaEnabled: boolean("hipaa_enabled").notNull().default(false),
  baaAcknowledgedAt: timestamp("baa_acknowledged_at", { withTimezone: true }),
  baaAcknowledgedBy: integer("baa_acknowledged_by"),
  // AI engagement mode for inbound texts. "assisted" (default) drafts a reply
  // as a private agent whisper only; "gated_auto" lets the Student auto-send the
  // SMS, but ONLY when every safety gate passes (see lib/engagementPolicy.ts).
  // Plain text (no DB enum/check) + app-level validation so a bad value can
  // never 500 a list query; unknown values are treated as "assisted".
  engagementMode: text("engagement_mode").notNull().default("assisted"),
  // When true (default), unregistered local numbers for this tenant are billed
  // the $10 Unregistered Carrier Surcharge. An admin can flip this off per
  // tenant from the Conductor /admin/tenants page to waive the surcharge.
  unregisteredSurchargeEnabled: boolean("unregistered_surcharge_enabled")
    .notNull()
    .default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Tenant = typeof tenantsTable.$inferSelect;
