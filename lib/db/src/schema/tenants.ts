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
  // Conductor-set short brand/vertical blurb the inbound triage router
  // (lib/ai-router) uses to decide whether an inbound SMS is in-scope. Plain
  // nullable text (NO DB CHECK) + app-level handling; null = router fails open
  // to the existing Classroom/Professor draft path.
  brandScope: text("brand_scope"),
  // Per-tenant EXTRA competitor names for the brand-safety scrubber, layered on
  // top of the platform-base list (SAMA_COMPETITOR_NAMES env). Comma-separated
  // free text (NO DB CHECK); null/empty = base list only. Managed from the
  // Conductor's per-tenant Brand Safety tab. See lib/brand-safety.
  competitorNamesExtra: text("competitor_names_extra"),
  // Conductor-set Co-Pilot holding-phrase draft. When an inbound is
  // tenant-specific but UNGROUNDED (no Classroom/KB match), the inbound pipeline
  // drafts this verbatim into the composer instead of letting the
  // Student/Professor guess at brand-specific pricing/policy/account facts. Plain
  // nullable text (NO DB CHECK); null/empty = existing Student/Professor draft
  // path (fail-open). Co-Pilot only — Manual/Auto-Pilot are untouched.
  fallbackPhrase: text("fallback_phrase"),
  // Conductor-set Auto-Pilot "graceful handback" holding phrase. When Auto-Pilot
  // REFUSES to auto-send (fail-closed gate) or its AI draft FAILS, the inbound
  // pipeline auto-sends THIS verbatim as a content-free acknowledgment (NOT an
  // answer) and KEEPS the Blue handback so a human still owns the real reply.
  // Distinct from fallbackPhrase: the Co-Pilot phrase is drafted for a human to
  // EDIT, whereas this is sent VERBATIM. Plain nullable text (NO DB CHECK);
  // null/empty = today's silent handback (fail-safe). Auto-Pilot only.
  autopilotHoldingPhrase: text("autopilot_holding_phrase"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status").notNull().default("none"),
  planTierCode: text("plan_tier_code"),
  trialUsed: boolean("trial_used").notNull().default(false),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  // Self-healing billing reconcile throttle. Stamped each time we verify a
  // locked-looking tenant against Stripe (see lib/billingReconcile.ts) so a
  // tenant refreshing the app or retrying a send can't hammer the Stripe API —
  // we re-check at most once per throttle window. Null = never reconciled.
  lastBillingSyncAt: timestamp("last_billing_sync_at", { withTimezone: true }),
  prepaidCredits: integer("prepaid_credits").notNull().default(0),
  overageEnabled: boolean("overage_enabled").notNull().default(false),
  // ---- Credit buckets (3-bucket waterfall: Included → Add-On → Backup) ----
  // Add-On credits: bought in fixed packs ($0.03/credit), ROLL OVER across
  // billing cycles. Drained AFTER the per-cycle Included bucket (tracked on
  // usage_records) and BEFORE Backup. Lazily migrated once from the legacy
  // prepaidCredits column on the first charge (see creditBucketsMigratedAt).
  addonCredits: integer("addon_credits").notNull().default(0),
  // Backup credits: $0.04/credit emergency reserve, auto-replenished in
  // 250-credit blocks the moment Included + Add-On hit zero. Drained LAST.
  backupCredits: integer("backup_credits").notNull().default(0),
  // Accrued NEGATIVE balance. Inbound texts cannot be blocked, so when a tenant
  // sits at zero with Backup off/declined an inbound charge accrues here as a
  // positive debt (effective balance = addon + backup - debt).
  creditDebt: integer("credit_debt").notNull().default(0),
  // Tenant toggle for Backup auto-replenish. When false (or a top-up declines)
  // OUTBOUND hard-stops at zero; inbound still accrues creditDebt.
  backupEnabled: boolean("backup_enabled").notNull().default(true),
  // Max Backup auto-top-ups per billing cycle before a HARD FREEZE (runaway-loop
  // guard). The per-cycle counter lives on usage_records.backupTopupsCount.
  backupTopupCapPerCycle: integer("backup_topup_cap_per_cycle").notNull().default(4),
  // ---- Automatic backup credits (auto-recharge) ------------------------------
  // Owner-configured proactive top-up: when the effective available balance
  // (Included remaining + Add-On + Backup) drops to autoRechargeThresholdCredits,
  // an OFF-hot-path worker charges the saved card off-session for
  // autoRechargeAmountCredits worth of Backup credits ($0.04/credit, 250-credit
  // blocks). Distinct from the (now neutralized) inline emergency replenish.
  autoRechargeEnabled: boolean("auto_recharge_enabled").notNull().default(false),
  // Low-water mark in total available credits. When balance <= this, recharge.
  autoRechargeThresholdCredits: integer("auto_recharge_threshold_credits").notNull().default(0),
  // Credits to buy per recharge. Multiple of 250 (one block = 250 @ $10). Clamped
  // by backupTopupCapPerCycle at charge time.
  autoRechargeAmountCredits: integer("auto_recharge_amount_credits").notNull().default(250),
  // Saved Stripe payment method used for off-session charges. Null = no card on
  // file → auto-recharge cannot be enabled. Card display fields mirror Stripe.
  autoRechargePaymentMethodId: text("auto_recharge_payment_method_id"),
  autoRechargeCardBrand: text("auto_recharge_card_brand"),
  autoRechargeCardLast4: text("auto_recharge_card_last4"),
  autoRechargeCardExpMonth: integer("auto_recharge_card_exp_month"),
  autoRechargeCardExpYear: integer("auto_recharge_card_exp_year"),
  autoRechargeLastAttemptAt: timestamp("auto_recharge_last_attempt_at", { withTimezone: true }),
  autoRechargeLastSuccessAt: timestamp("auto_recharge_last_success_at", { withTimezone: true }),
  autoRechargeLastFailureAt: timestamp("auto_recharge_last_failure_at", { withTimezone: true }),
  autoRechargeLastFailureReason: text("auto_recharge_last_failure_reason"),
  // Consecutive failure count; reset to 0 on a successful recharge or new card.
  autoRechargeDeclineCount: integer("auto_recharge_decline_count").notNull().default(0),
  // Frozen after a hard card decline or repeated failures — an owner must save a
  // new card / re-enable to clear it. Null = not suspended.
  autoRechargeSuspendedAt: timestamp("auto_recharge_suspended_at", { withTimezone: true }),
  // Backoff gate: no attempt before this time. Null = eligible now.
  autoRechargeNextRetryAt: timestamp("auto_recharge_next_retry_at", { withTimezone: true }),
  // One-time lazy-migration marker: on the first credit charge we copy the
  // legacy prepaidCredits balance into addonCredits and stamp this. Null = not
  // yet migrated.
  creditBucketsMigratedAt: timestamp("credit_buckets_migrated_at", { withTimezone: true }),
  quietHoursStart: integer("quiet_hours_start"),
  quietHoursEnd: integer("quiet_hours_end"),
  quietHoursTz: text("quiet_hours_tz").notNull().default("America/New_York"),
  frequencyCapPerDay: integer("frequency_cap_per_day").notNull().default(0),
  requireDoubleOptIn: boolean("require_double_opt_in").notNull().default(false),
  hipaaEnabled: boolean("hipaa_enabled").notNull().default(false),
  baaAcknowledgedAt: timestamp("baa_acknowledged_at", { withTimezone: true }),
  baaAcknowledgedBy: integer("baa_acknowledged_by"),
  // AI engagement mode for inbound texts (see lib/engagementPolicy.ts):
  //   "manual"    = AI off (no draft, no auto-send, no learning)
  //   "copilot"   = drafts a reply into the agent composer; human edits + sends;
  //                 NEVER learns (default)
  //   "autopilot" = may auto-send verbatim when every safety gate passes, and
  //                 only then persists what it learned
  // Legacy values "assisted"/"gated_auto" are still stored on old rows and are
  // normalized to copilot/autopilot at read time. Plain text (no DB enum/check)
  // + app-level validation so a bad value can never 500 a list query; unknown
  // values are treated as "copilot".
  engagementMode: text("engagement_mode").notNull().default("copilot"),
  // When true (default), unregistered local numbers for this tenant are billed
  // the $10 Unregistered Carrier Surcharge. An admin can flip this off per
  // tenant from the Conductor /admin/tenants page to waive the surcharge.
  unregisteredSurchargeEnabled: boolean("unregistered_surcharge_enabled")
    .notNull()
    .default(true),
  // Operator "Auto Approve / Auto Subscribed" override. When true the tenant is
  // treated as a paid subscriber and bypasses the demo paywall (isTextingUnlocked
  // returns true) regardless of subscriptionStatus — lets an operator test the
  // paid experience without going through the payment gateway. Default false.
  billingBypass: boolean("billing_bypass").notNull().default(false),
  // ---- Tenant lifecycle (reversible soft-archive → scheduled/manual purge) ----
  // Reversible deactivation state. Plain text + app-level validation (NO DB
  // enum/check — a bad value must never 500 the raw-row tenants list). Canonical
  // values: "active" (default) | "archived". Archived tenants are hidden from
  // the default Conductor list, blocked from tenant login + inbound processing,
  // and eligible for the purge job. Unknown values are treated as "active".
  lifecycleStatus: text("lifecycle_status").notNull().default("active"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: text("archived_by"),
  archiveReason: text("archive_reason"),
  // Archive stamps this to now()+30d; the 60s purge job hard-deletes the tenant
  // once purgeAfter <= now(). Operator-overridable. Null = never auto-purge.
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
  // Last reason the purge job SKIPPED this tenant (e.g. still owns phone numbers
  // — external Twilio resources are never auto-released). Visibility only;
  // cleared on restore. Null = not blocked.
  purgeBlockedReason: text("purge_blocked_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Tenant = typeof tenantsTable.$inferSelect;
