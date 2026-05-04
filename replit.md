# Project SAMA — Control Plane & User Messaging

## Overview
Project SAMA (Simple but Advanced Messaging Alternative) is a multi-tenant control plane designed to manage communication flows. It features a Master Conductor for overseeing tenants, injecting messages into the SAMA pipe, and monitoring inbound webhooks. SAMA aims to provide a robust, scalable, and intelligent messaging solution for businesses, offering multi-tenant management, AI-powered knowledge bases, and a user-friendly messaging inbox for customer agents.

## User Preferences
No specific user preferences were provided in the original document.

## System Architecture

### Core Architecture
- **Monorepo**: Utilizes a pnpm workspace.
- **Contract-first API Design**: API specifications defined using OpenAPI (`lib/api-spec/openapi.yaml`), generating client code and Zod schemas.
- **Database**: PostgreSQL with Drizzle ORM for managing core entities like tenants, users, and conversations.
- **API Server**: An Express.js application (`artifacts/api-server`).
- **Admin UI**: A React application (`artifacts/eng-architect`) with Vite, wouter, and shadcn. Served at `/admin/`.
- **User UI**: A React application (`artifacts/user-app`) with Vite, wouter, and shadcn, providing a Textline-style messaging inbox. Served at `/` (root — the front door).

### Key Features & Implementations
- **Modular Sender Pipeline**: Pluggable message sender interface.
- **Conductor Authentication**: HTTP Basic Auth for admin APIs, with bypasses for public and tenant-scoped routes.
- **Multi-Tenant Intelligence**: Inbound routing by tenant phone numbers, per-tenant `From` numbers for outbound messages, and Chatwoot integration.
- **AI Student & Knowledge Base**: Tenants upload documents (PDF/TXT/MD/CSV) for an AI Student (GPT-4o-mini) to use for RAG-contextualized responses, provided as private notes in Chatwoot.
- **10DLC Compliance Monitoring**: Integrates with Twilio Trust Hub APIs for real-time compliance status.
- **User & Tenant Authentication**: Separate mechanisms for admin (Bearer tokens) and tenant agents (JWTs).
- **Conversation Management**: Features for claiming, transferring, unassigning conversations, and managing events.
- **Department & Agent Management**: Functionality for creating departments, assigning phone numbers, managing agent roles, statuses, skills, and languages, including routing strategies.
- **UI/UX**: React-based UIs with Vite, wouter, and shadcn, distinct branding, and themes. The User UI offers a two-panel inbox and agent status indicators.
- **Billing & Subscriptions**: Stripe billing with a stub implementation, supporting subscription plans (starter/growth/enterprise), a per-message credit model, usage metering, and a free trial flow. The architecture is swap-ready for real Stripe integration.
- **Automations & Shortcuts**: Includes automation rules (keyword replies, follow-up timers, auto-resolve, welcome messages, opt-out management) and message templates (shortcuts) with a UI for management and an inbox picker.
- **Campaigns (Phase 6 — Commercial Megaphone)**: Bulk SMS campaigns with audience segmentation (tags + status + last-interaction), `{{first_name}}`/`{{full_name}}`/`{{phone}}` variable injection, pre-flight credit checks (prepaid + included + overage), GSM-7/UCS-2 segment-aware billing, and atomic rate-limited delivery (10 msg/sec). **Scheduler autonomy**: campaigns can be created with `scheduledAt` and the timer engine (60s cycle) auto-fires them via `activateScheduledCampaign`. **Twilio delivery webhook** at `/api/webhooks/twilio/status` updates `campaign_messages.delivered_at` and increments `campaigns.delivered_count`; the `StubSender` simulates this in-process via `simulateDeliveryCallback` (Sim-Vibe) for local testing. **Last-touch attribution** (72h window) credits inbound replies to `campaigns.response_count` and stamps `campaign_messages.responded_at` (idempotent); STOP/UNSUBSCRIBE writes the `campaign_id` Smoking Gun onto the `opt_outs` row and bumps `campaigns.opt_out_count` so tenants see *which* campaign caused the unsubscribe. UI surfaces a "Send now / Schedule for later" toggle in the wizard, a `scheduled` badge in the list, and Delivered / Responses / Opt-Outs cards on the detail page.
- **Auto-Seed Strategy**: Idempotent seed data for tiers, demo tenants (ACME Corp, Orbital Logistics, Helvetia Privatbank), departments, conversations, billing, automation rules, message templates, and campaign credits. This creates a testable sandbox environment.

## External Dependencies

- **Twilio**: Direct message sending, inbound routing, and 10DLC compliance monitoring.
- **Chatwoot**: Sovereign bridging, conversation management, and posting AI-generated notes.
- **OpenAI**: `gpt-4o-mini` for the AI Student Whisperer (knowledge base interaction, drafting replies).
- **PostgreSQL**: Primary database for all data persistence.
- **pdfjs-dist**: Used for text extraction from PDF files for knowledge base uploads.