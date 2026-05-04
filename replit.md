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

### Auto-Seed Strategy
- **Location**: `artifacts/api-server/src/lib/seedData.ts`, called from `index.ts` on every startup
- **Idempotent**: All seed operations check for existing data before inserting — safe to run repeatedly
- **What it seeds**:
  - Tier pricing (Starter/Growth/Enterprise with monthly prices, credit limits, trial days, agent/phone caps)
  - Demo tenants (ACME Corp, Orbital Logistics, Helvetia Privatbank) if missing
  - Departments for ACME (Customer Support, Sales, Marketing) if missing
  - 6 demo conversations with realistic message threads (account help, order tracking, subscription upgrade, sales inquiry, German routing) if missing
  - Billing demo: puts ACME on a Starter free trial with a "Trial Started" billing event and usage record reflecting actual outbound message count
- **Production behavior**: On first publish, the seed ensures tiers have pricing and ACME has demo data to interact with. Existing data is never overwritten.
- **Future vision**: This seed provides a testable sandbox. Next phase will add user sign-on with seeded demo data per org and a "+Create Organization" button.

## External Dependencies

- **Twilio**: For direct message sending, inbound routing, and 10DLC compliance monitoring (Trust Hub APIs).
- **Chatwoot**: For sovereign bridging, conversation management, and posting AI-generated notes.
- **OpenAI**: Specifically `gpt-4o-mini`, used for the AI Student Whisperer for knowledge base interaction and drafting replies.
- **n8n**: Optional, used as a downstream observer/orchestrator for non-blocking notifications of send results.
- **PostgreSQL**: External database used for all data persistence.
- **pdfjs-dist**: Used for extracting text from PDF files during knowledge base uploads.