# Phase 7.2 — Surveys (CSAT first, NPS-ready)

> Picked up from `Phase7.1.md` deferred item #6. Closes out the original "advanced inbox" vision.
> MMS and group messaging remain deferred to dedicated sessions.

---

## In scope this session

| # | Feature | Notes |
|---|---------|-------|
| 1 | Survey definition (one per tenant, type=csat) | Schema supports `nps` later |
| 2 | Auto-send on conversation close | Optional toggle per survey |
| 3 | Public response page (no auth, token link) | Served by api-server |
| 4 | Response recording + de-dup | One response per send token |
| 5 | Analytics — CSAT score, count, trend | New `/api/analytics/csat` |
| 6 | Settings → Surveys tab | Edit prompt, toggle on/off, view recent responses |

## Deferred (follow-up)

- NPS variant (schema ready, UI not built)
- Inbound SMS reply handling (e.g. customer texts "5" back) — current flow is link-only
- Per-agent CSAT breakdown
- Survey templates marketplace

---

## Schema (additive only)

```sql
-- one row per tenant; created lazily on first visit to Settings → Surveys
CREATE TABLE surveys (
  id            serial PRIMARY KEY,
  tenant_id     int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type          text NOT NULL DEFAULT 'csat',  -- 'csat' | 'nps'
  enabled       boolean NOT NULL DEFAULT false,
  prompt        text NOT NULL DEFAULT 'How would you rate your experience? Reply with this link:',
  thank_you     text NOT NULL DEFAULT 'Thanks for your feedback!',
  send_after_close boolean NOT NULL DEFAULT true,
  send_delay_minutes int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type)
);

-- one row per outbound survey link
CREATE TABLE survey_sends (
  id              serial PRIMARY KEY,
  tenant_id       int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  survey_id       int NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  conversation_id int REFERENCES conversations(id) ON DELETE SET NULL,
  contact_phone   text NOT NULL,
  token           text NOT NULL UNIQUE,           -- 24-char url-safe random
  sent_at         timestamptz,
  expires_at      timestamptz NOT NULL,           -- now() + 14 days
  status          text NOT NULL DEFAULT 'pending', -- pending|sent|responded|expired|failed
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON survey_sends (tenant_id, created_at);
CREATE INDEX ON survey_sends (status, sent_at) WHERE status = 'pending';

-- one row per submitted response
CREATE TABLE survey_responses (
  id              serial PRIMARY KEY,
  tenant_id       int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  send_id         int NOT NULL REFERENCES survey_sends(id) ON DELETE CASCADE UNIQUE,
  score           int NOT NULL,                   -- 1..5 (csat) or 0..10 (nps)
  comment         text,
  responded_at    timestamptz NOT NULL DEFAULT now(),
  ip              text,
  user_agent      text
);
CREATE INDEX ON survey_responses (tenant_id, responded_at);
```

---

## API

### Tenant-scoped (admin)
- `GET /api/surveys` — list (currently 0 or 1 row).
- `PUT /api/surveys` — upsert single survey definition for the tenant.
- `GET /api/surveys/responses?from=&to=&limit=&offset=` — paginated responses with conversation + score + comment.
- `GET /api/analytics/csat?from=&to=` — `{ avg, count, sentCount, responseRate, dailyAvg: [{date, avg, count}] }`.

### Public (no auth)
- `GET /api/s/:token` — returns a small self-contained HTML page with the rating form. Renders a friendly "expired" / "already submitted" page for invalid tokens.
- `POST /api/s/:token` — body `{ score: int, comment?: string }`. Creates `survey_responses`, updates `survey_sends.status='responded'`. Returns the thank-you HTML.

Conductor-auth middleware whitelisted for `/api/s/*` and `/api/surveys`.

---

## Trigger flow (auto-send on close)

1. Existing `PATCH /conversations/:id` close handler, after writing the `resolved` event:
   - If tenant has `surveys.enabled=true` AND `send_after_close=true`, AND the contact has not opted out, AND `checkOutboundCompliance` passes (re-use Phase 9.1 gate), enqueue a `survey_send` row (`status='pending'`, token generated, expires in 14d).
2. The 60s `timerEngine` cycle picks up `pending` sends past their `send_delay_minutes` and dispatches via the existing `Sender` interface. URL: `${REPLIT_DOMAINS[0]}/api/s/<token>`. Marks `status='sent'`. On error, `status='failed'` + records `error`.
3. Public page POST records the response and stamps `status='responded'`.

---

## UI

### Settings → Surveys tab
- Toggle: enabled (on/off)
- Editable prompt textarea (with `{{link}}` placeholder shown as the rendered survey URL)
- Editable thank-you text
- Toggle: send_after_close
- Number input: send_delay_minutes (0–60)
- Recent responses table (score, comment, contact, date)
- Average CSAT card (last 30 days)

### Analytics dashboard
- New "CSAT" card on the overview row (avg + count + response rate).
- Optional small line chart in the volume row (defer if tight on time).

---

## Execution order

1. Schema + push.
2. Routes (`surveys`, public `/s`, analytics CSAT).
3. Auto-send hook in `conversations.ts` close path + timer-engine processor.
4. Conductor-auth whitelist updates.
5. Settings UI tab.
6. Analytics CSAT card.
7. e2e smoke: enable survey → close conversation → verify send row → hit public URL → submit score → verify response + analytics.
8. Architect review → fix MUST-FIX.
9. Update `replit.md`.

## Out of scope (explicit non-goals this session)

- NPS UI (schema supports it; flip later)
- Per-agent CSAT
- Inbound SMS short-reply handling
- Survey templates / multi-question surveys
- Email survey channel
