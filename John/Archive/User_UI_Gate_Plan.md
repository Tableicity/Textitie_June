# SAMA User UI — Gate Plan

**Benchmark:** Textline.com
**Artifact:** `/app` (separate from Admin Console at `/`)
**Target users:** Paying tenants — the businesses that text their customers through your platform

---

## Gate 1: Foundation + Conversation Inbox

The core Textline experience — a clean conversation inbox where agents send and receive texts.

| Component | Details |
|---|---|
| New React artifact | `/app` — separate from Admin Console |
| Tenant auth | `tenant_users` table, tenant-scoped login, JWT tokens |
| Shell layout | Sidebar nav, conversation-centric 2-panel layout |
| Conversations list | Left panel — contact name, last message preview, timestamp |
| Message thread | Right panel — full conversation with message input |
| Send messages | Fires through existing Twilio pipeline |
| Contact display | Name, phone number, basic info |

**Greyed out (visible but disabled):** Settings, Analytics, Phone Numbers, Team

---

## Gate 2: Live Messaging + Contacts

Wire the UI to real Chatwoot data. Conversations update in near-real-time.

| Component | Details |
|---|---|
| Chatwoot proxy API | Server-side proxy to tenant's Chatwoot inbox |
| Real-time updates | Polling (then upgrade to WebSocket) |
| Contact management | Create, edit, search contacts |
| Conversation status | Open / Resolved / Snoozed |
| Unread counts | Badge on conversations |

---

## Gate 3: Self-Service + Numbers

Tenants can buy phone numbers and manage their account without calling you.

| Component | Details |
|---|---|
| Phone number search | Twilio inventory search inside the UI |
| Number purchase | One-click buy, auto-assign to tenant |
| Account settings | Profile, timezone, business hours |
| Token/credit balance | Display current usage and balance |

---

## Gate 4: AI Agent Layer

The differentiator — AI is baked into the messaging experience.

| Component | Details |
|---|---|
| AI Whisper panel | Agent sees AI-suggested reply before responding |
| Smart reply buttons | One-click to use AI suggestion |
| Conversation summary | AI-generated summary at top of long threads |
| KB-powered responses | Tenant's knowledge base drives the suggestions |

---

## Gate 5: Team + Billing

Multi-agent support and revenue infrastructure.

| Component | Details |
|---|---|
| Team management | Invite agents, assign roles (admin/agent) |
| Conversation assignment | Assign conversations to specific agents |
| Stripe billing | Subscription plans, usage-based add-ons |
| Usage analytics | Messages sent, response times, AI usage |

---

## Architecture

```
Admin Console (/)           User UI (/app)
      |                         |
      +--------> API Server <---+
                    |
            +-------+-------+
            |               |
        Database        Chatwoot API
      (tenants,        (textitie.com)
       tenant_users,    conversations,
       users, etc.)     messages, contacts
```

## Data Model Addition

```
tenant_users
  id          serial PK
  tenant_id   integer FK -> tenants.id
  email       text UNIQUE
  password_hash text
  name        text
  role        text (admin | agent)
  created_at  timestamp
```
