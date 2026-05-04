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
- **Campaigns**: Supports SMS campaigns with audience segmentation, variable injection, credit management, and rate-limited delivery. Features include pre-flight credit checks and atomic campaign execution.
- **Auto-Seed Strategy**: Idempotent seed data for tiers, demo tenants (ACME Corp, Orbital Logistics, Helvetia Privatbank), departments, conversations, billing, automation rules, message templates, and campaign credits. This creates a testable sandbox environment.

## External Dependencies

- **Twilio**: Direct message sending, inbound routing, and 10DLC compliance monitoring.
- **Chatwoot**: Sovereign bridging, conversation management, and posting AI-generated notes.
- **OpenAI**: `gpt-4o-mini` for the AI Student Whisperer (knowledge base interaction, drafting replies).
- **PostgreSQL**: Primary database for all data persistence.
- **pdfjs-dist**: Used for text extraction from PDF files for knowledge base uploads.