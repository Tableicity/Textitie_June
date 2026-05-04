# Project SAMA — Control Plane & User Messaging

## Overview
Project SAMA (Simple but Advanced Messaging Alternative) is a multi-tenant control plane designed to manage communication flows. It features a Master Conductor for overseeing tenants, injecting messages into the SAMA pipe, and monitoring inbound webhooks. The project integrates with external services like Twilio for direct sending, Chatwoot for sovereign bridging, and OpenAI's GPT-4o-mini for AI-driven assistance. SAMA aims to provide a robust, scalable, and intelligent messaging solution for businesses, offering features like multi-tenant management, AI-powered knowledge bases, and a user-friendly messaging inbox for customer agents.

## User Preferences
No specific user preferences were provided in the original document.

## System Architecture

### Core Architecture
- **Monorepo**: Utilizes a pnpm workspace for managing multiple packages.
- **Contract-first API Design**: API specifications are defined using OpenAPI (`lib/api-spec/openapi.yaml`), generating client code and Zod schemas for strong typing and validation.
- **Database**: PostgreSQL with Drizzle ORM, managing schemas for tenants, users, conversations, and other core entities.
- **API Server**: An Express.js application (`artifacts/api-server`) serving the API.
- **Admin UI**: A React application (`artifacts/eng-architect`) built with Vite, wouter, and shadcn for administrative tasks.
- **User UI**: A React application (`artifacts/user-app`) built with Vite, wouter, and shadcn, providing a Textline-style messaging inbox for tenant agents.

### Key Features & Implementations
- **Modular Sender Pipeline**: Pluggable message sender interface allowing easy swapping between different sending engines (e.g., Twilio, StubSender).
- **Conductor Authentication**: HTTP Basic Auth for administrative API access, with bypasses for public endpoints and tenant-scoped routes.
- **Multi-Tenant Intelligence**: Inbound routing based on tenant phone numbers, per-tenant `From` numbers for outbound messages, and integration with Chatwoot for conversation management.
- **AI Student & Knowledge Base**: Tenants can upload documents (PDF/TXT/MD/CSV) to build a knowledge base, which the AI Student (GPT-4o-mini) uses for RAG-contextualized responses, provided as private notes in Chatwoot.
- **10DLC Compliance Monitoring**: Integrates with Twilio Trust Hub APIs to provide real-time 10DLC compliance status.
- **User & Tenant Authentication**: Separate authentication mechanisms for admin users (Bearer tokens) and tenant agents (JWTs with `scope: "tenant"`).
- **Conversation Management**: Features for claiming, transferring, unassigning conversations, and managing conversation events.
- **Department & Agent Management**: Functionality for creating departments, assigning phone numbers, managing agent roles, statuses, skills, and languages, including routing strategies for conversation assignment.
- **UI/UX**: Both Admin and User UIs are built with React, Vite, wouter, and shadcn, featuring distinct branding and themes for their respective user bases. The User UI provides a two-panel inbox, settings pages for departments, phone numbers, and team management, and agent status indicators.
- **Billing & Subscriptions (Phase 4)**: Stripe billing with stub implementation (no real keys needed). Subscription plans mapped to tiers (starter/growth/enterprise), per-message credits model ($0.03/credit overage), usage metering, free trial flow (14-day, one-time per tenant), upgrade/downgrade flows, billing dashboard with plan cards, usage meter, and event history. Stub is swap-ready for real Stripe integration.

### Phase 4 — Billing Architecture
- **Schema Changes**:
  - `tiers` table extended: `monthly_price_cents`, `included_credits`, `trial_days`, `max_agents`, `max_phone_numbers`
  - `tenants` table extended: `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (none/trialing/active/past_due/canceled), `plan_tier_code`, `trial_used` (boolean, prevents trial abuse), `trial_ends_at`, `current_period_start`, `current_period_end`
  - New `usage_records` table: per-tenant monthly usage tracking with unique constraint on (tenant_id, period_start); atomic SQL increments for concurrent safety
  - New `billing_events` table: audit trail of all billing actions (subscribed/trial_started/upgraded/downgraded/canceled/payment_succeeded/payment_failed)
- **Stub Stripe Service** (`artifacts/api-server/src/lib/stripe-stub.ts`): Self-contained billing engine simulating Stripe operations locally. Race-safe state transitions via conditional WHERE clauses. Atomic usage counting via raw SQL `SET field = field + 1`. Trial guard prevents repeated free trials per tenant.
- **Billing API Endpoints** (all require tenant auth, bypassed from conductor auth):
  - `GET /api/billing/plans` — list plans with pricing
  - `GET /api/billing/subscription` — current tenant subscription details
  - `POST /api/billing/subscribe` — start subscription (with trial if eligible)
  - `POST /api/billing/change-plan` — upgrade/downgrade
  - `POST /api/billing/cancel` — cancel subscription
  - `GET /api/billing/usage` — current period usage stats
  - `GET /api/billing/history` — billing event history
- **Usage Tracking**: Wired into `POST /conversations/:id/messages` — each outbound message fires `recordMessageUsage()` (non-blocking) which atomically increments credits_used and calculates overage.
- **Tier Pricing**: Starter $29/mo (1,000 credits, 3 agents, 1 phone), Growth $79/mo (5,000 credits, 10 agents, 5 phones), Enterprise $199/mo (unlimited credits/agents/phones). Overage: $0.03/credit. Phone add-on: $5/mo.
- **Billing Dashboard UI** (`artifacts/user-app/src/pages/Billing.tsx`): Current plan card with status badge + trial countdown, usage meter with progress bar, plan comparison cards with upgrade/downgrade, billing history timeline, confirmation dialogs, toast notifications for success/error.

### Phase 5 — Automations & Shortcuts
- **Schema Changes**:
  - New `automation_rules` table: id, tenant_id, type (keyword_reply/follow_up_timer/auto_resolve/welcome_message/auto_unsubscribe), name, enabled, trigger_config (jsonb), action_config (jsonb), priority, created_at, updated_at
  - New `message_templates` table: id, tenant_id, name, shortcut_key, body, category, created_by, created_at, updated_at. Unique index on (tenant_id, shortcut_key).
  - New `opt_outs` table: id, tenant_id, phone_number (unique per tenant), opted_out_at, reason
- **Automation Engine** (`artifacts/api-server/src/lib/automationEngine.ts`):
  - `processInboundMessage()`: Pipeline that runs on every inbound Twilio SMS. Checks START keyword for re-subscribe first, then checks opt-out status, TCPA keywords (STOP/END/UNSUBSCRIBE/CANCEL/QUIT → opt-out + confirmation + close conversation), welcome message for first conversation messages, keyword auto-reply (exact/contains/regex matching).
  - `handleResubscribe()`: Removes opt-out record when contact sends START.
  - Wired into `webhooks.ts` Twilio inbound handler: finds/creates conversation, persists inbound message, runs automation pipeline (fire-and-forget).
- **Timer Engine** (`artifacts/api-server/src/lib/timerEngine.ts`):
  - 60s polling loop started on boot.
  - `processFollowUpTimers()`: Sends follow-up after X hours of inactivity (dedup via conversation_events check).
  - `processAutoResolve()`: Closes conversations after X hours of inactivity, sends closing message.
- **API Endpoints** (all require tenant auth, bypassed from conductor auth):
  - `GET /api/automations` — list automation rules
  - `POST /api/automations` — create rule
  - `PATCH /api/automations/:id` — update rule
  - `DELETE /api/automations/:id` — delete rule
  - `GET /api/shortcuts` — list message templates
  - `POST /api/shortcuts` — create template
  - `PATCH /api/shortcuts/:id` — update template
  - `DELETE /api/shortcuts/:id` — delete template
  - `GET /api/opt-outs` — list opted-out numbers
  - `DELETE /api/opt-outs/:id` — re-subscribe (remove opt-out)
- **Automations UI** (`artifacts/user-app/src/pages/Automations.tsx`):
  - Three-tab layout: Rules (CRUD with toggle enable/disable), Shortcuts (grid cards with CRUD), Opt-outs (table with re-subscribe)
  - Rule cards show type badge, active/disabled status, keywords, timer hours, and reply preview
  - Create/edit dialogs with type-specific fields (keywords, match type, inactive hours, reply body)
  - Nav: Zap icon in sidebar between Settings and Billing
- **Inbox Shortcuts Picker** (`artifacts/user-app/src/pages/Inbox.tsx`):
  - Type "/" in composer to show shortcuts dropdown above input
  - Filters in real-time as you type (e.g., "/hel" → shows "/hello")
  - Keyboard navigation (arrow up/down, Tab/Enter to select, Escape to dismiss)
  - Click/select inserts full template body into composer
- **Demo Seed Data**: 6 automation rules (welcome, 2 keyword replies, follow-up timer, auto-resolve, TCPA) and 7 shortcuts (/hello, /transfer, /hours, /bye, /escalate, /order, /refund) seeded for ACME Corp.

### Phase 6 — Campaigns ("Commercial Megaphone")
- **Schema Changes**:
  - `tenants` table extended: `prepaid_credits` (int, default 0), `overage_enabled` (bool, default false)
  - `conversations` table extended: `tags` (text[], default empty) for audience segmentation
  - New `campaigns` table: id, tenant_id, name, body (template), status (draft/sending/paused/completed/failed), segment_filter (jsonb), total_recipients, queued_count, sent_count, delivered_count, failed_count, response_count, opt_out_count, credits_required, created_by, timestamps (created_at, scheduled_at, started_at, completed_at)
  - New `campaign_messages` table: id, campaign_id, conversation_id, contact_phone, contact_name, rendered_body, status (queued/sending/sent/delivered/failed), sent_at, error_message
- **SMS Utils** (`artifacts/api-server/src/lib/smsUtils.ts`):
  - `calculateSegments(text)`: GSM-7 charset detection (160/153 chars per segment) vs UCS-2 for emoji/unicode (70/67 chars per segment), extended table handling
  - `injectVariables(template, vars)`: Regex-based `{{first_name}}`, `{{full_name}}`, `{{phone}}` substitution
  - `extractContactVars(contactName, phone)`: Derives first/last/full names from contact data
- **Credit Engine** (`artifacts/api-server/src/lib/creditEngine.ts`):
  - `preFlightCheck(tenantId, recipientCount, segmentsPerMessage)`: Combines prepaid_credits + remaining included credits from usage_records. Enterprise tier gets unlimited. Returns allowed/required/available/shortfall/overageEnabled
  - `deductCampaignCredits(tenantId, creditsUsed)`: Drains prepaid first, overflow to usage_records with overage calculation ($0.03/credit)
  - `getCreditBalance()`, `addPrepaidCredits()`: Balance queries and top-up
- **Campaign Engine** (`artifacts/api-server/src/lib/campaignEngine.ts`):
  - Rate-limited delivery: 10 msgs/sec via batched intervals with 1s cooldown
  - Atomic row claiming: `FOR UPDATE SKIP LOCKED` prevents duplicate sends across concurrent executors
  - Per-recipient: claims queued→sending, sends via getSender(), updates status to sent/failed
  - Credit deduction uses per-rendered-message segment counting (not template segments) for accuracy
  - Failed credit deduction marks campaign as failed (not silently ignored)
  - `buildAudience()`: Tenant-scoped query with tag overlap (`&&`), status, and interaction time filters; excludes opted-out numbers
  - `createCampaignMessages()`: Bulk insert with per-recipient variable injection
- **Race Condition Protections**:
  - Send route uses atomic `UPDATE ... WHERE status = 'draft' RETURNING id` to prevent duplicate sends from concurrent requests
  - Batch processing uses `FOR UPDATE SKIP LOCKED` for worker-safe message claiming
  - `executeCampaign()` only accepts `status = 'sending'` (set atomically by send route)
- **API Endpoints** (all require tenant auth, bypassed from conductor auth):
  - `GET /api/campaigns` — list campaigns for tenant
  - `POST /api/campaigns` — create draft campaign
  - `GET /api/campaigns/:id` — get campaign with stats
  - `POST /api/campaigns/:id/send` — atomic draft→sending, pre-flight credit check, enqueue recipients, fire-and-forget execution
  - `DELETE /api/campaigns/:id` — delete draft campaign (blocks if sending)
  - `GET /api/campaigns/:id/messages` — list recipient statuses
  - `POST /api/campaigns/audience-preview` — preview audience count with tag/status/interaction filters
  - `GET /api/campaigns/credits` — current credit balance (prepaid + included + overage status)
  - `POST /api/campaigns/top-up` — add prepaid credits
  - `PATCH /api/conversations/:id/tags` — update conversation tags
- **Campaigns UI** (`artifacts/user-app/src/pages/Campaigns.tsx`):
  - Campaign list view: cards with status badges, recipient counts, credit usage
  - 3-step create wizard: Audience (name + tag filter + live audience preview), Compose (message editor + variable buttons + live segment counter + message preview), Review (pre-flight credit check + send confirmation)
  - Campaign detail: progress bar, recipient table with per-message status, Send Now button
  - Credit balance card with top-up dialog
  - Empty state for no campaigns
  - Nav: Megaphone icon in sidebar between Automations and Billing
- **Seed Data**: ACME seeded with 5,000 prepaid credits, overageEnabled=false. Demo conversations tagged (vip, support, sales, prospect, orders, enterprise, resolved).

### Auto-Seed Strategy
- **Location**: `artifacts/api-server/src/lib/seedData.ts`, called from `index.ts` on every startup
- **Idempotent**: All seed operations check for existing data before inserting — safe to run repeatedly
- **What it seeds**:
  - Tier pricing (Starter/Growth/Enterprise with monthly prices, credit limits, trial days, agent/phone caps)
  - Demo tenants (ACME Corp, Orbital Logistics, Helvetia Privatbank) if missing
  - Departments for ACME (Customer Support, Sales, Marketing) if missing
  - 6 demo conversations with realistic message threads (account help, order tracking, subscription upgrade, sales inquiry, German routing) if missing
  - Billing demo: puts ACME on a Starter free trial with a "Trial Started" billing event and usage record reflecting actual outbound message count
  - 6 automation rules (welcome message, keyword replies for hours/pricing, 24h follow-up, 72h auto-resolve, TCPA opt-out) for ACME
  - 7 message template shortcuts (/hello, /transfer, /hours, /bye, /escalate, /order, /refund) for ACME
  - Campaign credits: ACME gets 5,000 prepaid credits, overageEnabled=false
  - Conversation tags: 6 demo conversations tagged with vip, support, sales, prospect, orders, enterprise, resolved
- **Production behavior**: On first publish, the seed ensures tiers have pricing and ACME has demo data to interact with. Existing data is never overwritten.
- **Future vision**: This seed provides a testable sandbox. Next phase will add user sign-on with seeded demo data per org and a "+Create Organization" button.

## External Dependencies

- **Twilio**: For direct message sending, inbound routing, and 10DLC compliance monitoring (Trust Hub APIs).
- **Chatwoot**: For sovereign bridging, conversation management, and posting AI-generated notes.
- **OpenAI**: Specifically `gpt-4o-mini`, used for the AI Student Whisperer for knowledge base interaction and drafting replies.
- **n8n**: Optional, used as a downstream observer/orchestrator for non-blocking notifications of send results.
- **PostgreSQL**: External database used for all data persistence.
- **pdfjs-dist**: Used for extracting text from PDF files during knowledge base uploads.