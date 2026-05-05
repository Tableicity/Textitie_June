# Project SAMA — Control Plane & User Messaging

## Overview
Project SAMA (Simple but Advanced Messaging Alternative) is a multi-tenant control plane designed for robust, scalable, and intelligent communication management. It features a Master Conductor for overseeing tenants, injecting messages, and monitoring webhooks. Key capabilities include multi-tenant management, an AI-powered knowledge base, a user-friendly messaging inbox for customer agents, and comprehensive compliance features. SAMA aims to revolutionize business communication by offering a sophisticated yet easy-to-use platform.

## User Preferences
No specific user preferences were provided in the original document.

## System Architecture

### Core Architecture
-   **Monorepo**: Utilizes a pnpm workspace.
-   **Contract-first API Design**: OpenAPI (`lib/api-spec/openapi.yaml`) defines API specifications, generating client code and Zod schemas.
-   **Database**: PostgreSQL with Drizzle ORM.
-   **API Server**: Express.js application (`artifacts/api-server`).
-   **Admin UI**: React application (`artifacts/eng-architect`) using Vite, wouter, and shadcn, served at `/admin/`.
-   **User UI**: React application (`artifacts/user-app`) using Vite, wouter, and shadcn, providing a Textline-style messaging inbox, served at `/` (root).

### Key Features & Implementations
-   **Modular Sender Pipeline**: Pluggable interface for message sending.
-   **Conductor Authentication**: HTTP Basic Auth for admin APIs; Bearer tokens for admin, JWTs for tenant agents.
-   **Multi-Tenant Intelligence**: Inbound routing by tenant phone numbers, per-tenant `From` numbers for outbound messages, and Chatwoot integration.
-   **AI Student & Knowledge Base**: Tenants upload documents (PDF/TXT/MD/CSV) for an AI Student (GPT-4o-mini) to generate RAG-contextualized responses as private notes in Chatwoot.
-   **10DLC Compliance Monitoring**: Integrates with Twilio Trust Hub APIs for real-time compliance status.
-   **Conversation Management**: Features for claiming, transferring, unassigning, and event management.
-   **Department & Agent Management**: Creation of departments, phone number assignment, agent roles, statuses, skills, languages, and routing strategies.
-   **UI/UX**: React-based UIs with distinct branding, themes, and a two-panel inbox with agent status indicators.
-   **Billing & Subscriptions**: Stripe billing (stubbed) with subscription plans, per-message credit model, usage metering, and free trial.
-   **Automations & Shortcuts**: Automation rules (keyword replies, follow-ups, auto-resolve, welcome messages, opt-out) and message templates (shortcuts) with UI management.
-   **Analytics & Insights**: Tenant-facing dashboard at `/analytics` with key performance indicators (KPIs) like total/open/closed conversations, response times, message counts, per-agent/department metrics, and CSV export. KPIs are computed on-the-fly from conversation and message data.
-   **Advanced Inbox Features**:
    -   **Whispers**: Internal notes (`messages.direction='internal'`) visible only to agents.
    -   **Dispositions**: Tenant-scoped resolution categories for conversations.
    -   **Contact Management & Tagging**: Tenant-scoped contact management with searchable lists, tags, and conversation history.
    -   **Conversation Search & Filtering**: Extended `GET /conversations` with various query parameters.
    -   **Reminders**: Tenant-scoped, per-user, conversation-linked reminders with notifications.
-   **Surveys (CSAT)**: One-tap customer satisfaction surveys delivered via SMS after conversation closure. Includes schema for surveys, sends, and responses, with auto-sending, a public response page, and dedicated analytics.
-   **Campaigns**: Bulk SMS campaigns with audience segmentation, variable injection, credit checks, segment-aware billing, and rate-limited delivery. Features include scheduling, Twilio delivery webhooks, and last-touch attribution for responses and opt-outs.
-   **Integrations & Compliance**:
    -   **Audit Log**: Comprehensive `audit_logs` table for tracking actions, indexed by entity, action, and timestamp.
    -   **TCPA Compliance Enhancements**: `opt_ins` table, tenant-level quiet hours, frequency caps, and double opt-in requirements. Outbound compliance checks prevent sending messages violating these rules.
    -   **HubSpot Connector (stub-first)**: Integration with HubSpot for CRM syncing (contacts, conversation activity) via a queue and a worker, with a simulation log for testing.
    -   **HIPAA Plan Flag**: Tier-based HIPAA eligibility with tenant-level `hipaaEnabled`, BAA acknowledgment, and PHI redaction in logs.
-   **Auto-Seed Strategy**: Idempotent seed data for consistent environment setup (tiers, demo tenants, departments, conversations, billing, etc.).

## External Dependencies

-   **Twilio**: Message sending, inbound routing, and 10DLC compliance.
-   **Chatwoot**: Sovereign bridging, conversation management, and AI-generated note posting.
-   **OpenAI**: `gpt-4o-mini` for the AI Student Whisperer.
-   **PostgreSQL**: Primary database.
-   **pdfjs-dist**: Used for text extraction from PDF files for the knowledge base.