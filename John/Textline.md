# Textline Feature Analysis — SAMA Messaging Roadmap

## About Textline

Textline is a business text messaging platform built for sales, marketing, and customer service. It supports larger companies with layered corporate structures, offering a unified inbox, team collaboration, automations, mass texting, and deep integrations. HIPAA-compliant, SOC 2 certified, CCPA and GDPR compliant.

---

## Textline Core Features

### Unified Inbox & Conversation Management
- Manage conversations via SMS, web chat, and social media from one inbox
- Claim new messages, transfer conversations to other team members
- Auto-route inbound messages to the right department/agent
- Resolve conversations without leaving the inbox
- Conversation search and filtering

### Departments (Phone Lines)
- Each phone line is a "Department" — organize by franchise location, branch, function
- Send SMS from multiple phone numbers
- Unified Inbox across all numbers/departments
- Agents can be assigned to more than one department

### Agents & Teams
- Invite agents to the account with role-based permissions
- Claim conversations, transfer between agents
- Auto-routing: round-robin, load-balanced, or last-assigned
- Group agents into teams by language, skill set, etc.
- Custom roles on Pro plans (limit or expand agent functionality)
- Agent KPI tracking

### Automations
- Keyword-triggered auto-replies
- Timer-based automations (schedule actions for future time)
- Auto-resolve inactive conversations
- Welcome text auto-response
- Survey after conversation resolution
- Compliance: auto-unsubscribe on STOP/END keywords
- Prioritize and stack automations

### Announcements (Mass/Bulk Texting)
- Send to thousands at once
- Schedule for later
- Audience segmentation
- Variable field personalization
- Campaign analytics: sends, deliveries, responses, opt-outs
- Option to resolve or leave conversations open

### Shortcuts (Message Templates)
- Pre-written text templates for quick replies
- Save time on common questions

### Whispers (Internal Notes)
- Private notes inside text threads
- Team collaboration without alerting the customer

### Surveys
- Built-in CSAT and NPS surveys
- Custom survey templates
- Integrated into the conversation flow

### Metrics & Insights
- Response time, resolution time, response rate
- Agent performance KPIs
- Department-level filtering
- CSV data export

### Phone Number Flexibility
- Provision new numbers
- Text-enable existing business numbers (landlines, VoIP, toll-free)
- 10DLC registration handled in-app
- Additional numbers at $9.99/mo each

### MMS Support
- Send PDFs, photos, links, and multimedia

### Group Messaging
- Text a group of contacts in a single thread

### Mobile Apps
- iOS and Android apps synced with web platform

---

## Textline Pricing Model

| Plan | Price | Best For |
|---|---|---|
| Limited | ~$16/mo per agent (annual) | Small teams exploring SMS |
| Essentials | ~$90/mo (includes 3 users) | Growing businesses |
| Pro | Higher tier | Advanced teams, custom roles & workflows |
| Enterprise | Custom quote | Large-scale / multi-site orgs |

### Add-ons & Extra Costs

| Item | Cost |
|---|---|
| Message credits | $0.03/credit (min. 500) |
| Backup credits (auto-refill) | $0.04/credit |
| Additional phone numbers | $9.99/mo |
| 10DLC number monthly fee | $15/mo |
| Web chatbot add-on | $29.99/mo |
| Annual discount | 20% off |
| HIPAA compliance | Additional fee |

Unused credits roll over and never expire.

### Integrations

HubSpot, Salesforce, Zendesk, Slack, Help Scout, Zapier, Talkdesk, Facebook Messenger, Instagram Business.

---

## SAMA Messaging — Current State vs. Textline

### What We Have (Gate 1 — Done)

- Tenant user login and auth (JWT, scoped tokens)
- Conversation inbox with 2-panel layout (list + thread)
- Message threading (inbound/outbound)
- Send/receive messages
- Multi-tenant isolation
- Admin Control Plane (separate app) with dashboard, tenants, injections, webhooks, compliance, AI Whisperer
- Twilio direct sender pipeline
- Chatwoot sovereign bridge

---

## SAMA Messaging — Build Phases

### Phase 2 — Departments & Phone Numbers
- "Departments" = phone lines with their own team of agents
- Buy a phone number (Twilio number provisioning API)
- Assign numbers to departments
- Unified inbox across multiple numbers/departments
- Text-enable existing numbers

### Phase 3 — Team & Agent Management
- Invite/manage multiple agents per tenant
- Roles: admin, agent, custom
- Conversation claiming (agent "takes" a conversation)
- Conversation transfer between agents
- Auto-routing (round-robin, load-balanced, last-assigned)
- Agent online/offline status
- Teams grouped by skill/language

### Phase 4 — Stripe Billing & Subscriptions
- Subscription plans mapped to tiers (starter/growth/enterprise)
- Per-message credits model ($0.03/credit style)
- Add-on phone numbers (per-number monthly fee)
- Usage metering and billing dashboard
- Free trial flow
- Upgrade/downgrade flows

### Phase 5 — Automations & Shortcuts
- Keyword-triggered auto-replies
- Timer-based automations (follow-up after X hours)
- Auto-resolve inactive conversations
- Message templates ("Shortcuts") for quick replies
- Welcome messages for new conversations
- Auto-unsubscribe on STOP/END (TCPA compliance)

### Phase 6 — Announcements (Mass Texting)
- Bulk send to contact lists
- Audience segmentation
- Schedule for later
- Campaign analytics (sends, deliveries, responses, opt-outs)
- Variable field personalization

### Phase 7 — Analytics & Insights
- Response time tracking
- Resolution time
- Agent performance KPIs
- Conversation volume trends
- Per-department metrics
- CSV export

### Phase 8 — Advanced Features
- Whispers (internal notes — partially exists via Chatwoot on admin side)
- Surveys (CSAT, NPS) after conversation resolution
- Group messaging
- MMS support (photos, PDFs, links)
- Contact management and tagging
- Conversation search and filtering
- Dispositions/resolution categories
- Reminders on individual conversations

### Phase 9 — Integrations & Compliance
- HubSpot, Salesforce, Slack connectors
- TCPA opt-out compliance
- HIPAA-compliant plan option
- Audit logs
- IP whitelisting, SAML/SSO
- API & webhooks for third-party developers

---

## Recommended Priority

The highest-value next steps that build toward a paying product:

1. **Phase 2 (Departments & Phone Numbers)** — let tenants buy and manage their own numbers
2. **Phase 3 (Agents)** — multi-agent support with routing and transfers
3. **Phase 4 (Stripe Billing)** — monetize with subscriptions and usage-based pricing

These three form the commercial backbone: tenants buy numbers, add their team, and pay for the service. Everything after that is feature richness on top of a paying product.
