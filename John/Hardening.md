# Production Hardening Backlog

Items intentionally deferred from feature work to a dedicated end-of-Build hardening pass. None are blockers for current Build-phase development against demo data; all become **must-fix** before pointing a real paying customer at the system.

---

## 1. Twilio Webhook Signature Validation — ✅ DONE

**Status (2026-06-08, verified in code + live prod):** Implemented in `artifacts/api-server/src/lib/twilioSignature.ts` (`twilio.validateRequest`). Applied to **both** routes — inbound `POST /webhooks/:source` via inline `checkTwilioSignature` (shared with chatwoot/n8n, so it rejects only a present-but-invalid Twilio signature) and delivery-status `POST /webhooks/twilio/status` via `requireTwilioSignature()` middleware. Live prod inbound smoke test returned 201 (valid) / 403 (invalid). The original problem statement below is retained for history.

**Where:** All Twilio-facing webhook endpoints in `artifacts/api-server/src/routes/webhooks.ts`
- `POST /api/webhooks/:source` (inbound SMS — pre-existing, since earlier phase)
- `POST /api/webhooks/twilio/status` (delivery status — added Phase 6)

**Problem:** Neither endpoint verifies the `X-Twilio-Signature` header. An attacker who knows or guesses a `MessageSid` (`external_id`) can:
- Spoof inbound SMS replies → injects fake messages into tenant inboxes, false-positive last-touch attribution, false opt-outs (Smoking Gun pointing at wrong campaign).
- Spoof delivery callbacks → skews `delivered_count` / `sent_count` analytics, can mark messages as `failed` to corrupt reporting.

**Fix:** Add an Express middleware `verifyTwilioSignature` using `twilio.validateRequest(authToken, signature, url, params)`. Apply to **both** webhook routes for consistency. Auth token is already in the per-tenant Twilio config (or env for the platform-wide number).

**Why deferred:** Project-wide gap, not a Phase 6 regression. Belongs in a single security pass alongside related items below, not bolted onto one new endpoint.

**Trigger to promote to "do now":** First real (non-demo) tenant onboarding, OR first time the API server is exposed on a public production domain that an attacker could discover.

---

## 2. Scheduler — Sequential Loop, In-Process Timer — MEDIUM

**Where:** `artifacts/api-server/src/lib/timerEngine.ts` → `processScheduledCampaigns`

**Problem:** Current implementation:
- Runs `setInterval` every 60s, in-process, in a single Node process.
- Selects up to 25 due campaigns and calls `activateScheduledCampaign` sequentially.
- If `createCampaignMessages` takes ~2s per campaign with a large audience, 25 campaigns = ~50s — pushing into the next cycle and risking lag/overlap.
- If we ever scale to multiple API server instances, every instance will independently try to fire every due campaign (the `status='draft' → 'active'` race-lost guard prevents double-send, but causes wasted work and noisy logs).

**Fix path (in order of investment):**
1. **Quick win:** Add `Promise.all` with a concurrency cap (e.g. p-limit at 5) — keeps single-process but parallelizes.
2. **Right answer:** Move to a real job queue — `pg-boss` (Postgres-native, no new infra) or `BullMQ` (needs Redis). Gives durable scheduling, distributed lock, retry/backoff, and dead-letter for free.

**Why deferred:** Only matters at scale (dozens of campaigns scheduled to fire in the same minute). Not a current usage pattern. The right fix is an architectural decision (queue vendor) that should be made deliberately, not patched.

**Trigger to promote:** First customer with >5 concurrently-scheduled campaigns in any 60s window, OR when we move to multi-instance API server deployment.

---

## 3. Sim-Vibe Shutdown Warning — LOW (Cosmetic)

**Where:** `artifacts/api-server/src/lib/deliveryStatus.ts` → `simulateDeliveryCallback`

**Problem:** The simulator is fire-and-forget (`setTimeout` → async DB write). On graceful server shutdown mid-test, the deferred callback can hit a closed DB pool and emit a warning log line.

**Fix:** Track outstanding sim-vibe timers in a `Set<NodeJS.Timeout>`; on `SIGTERM`, `clearTimeout` all of them before closing the pool. Or wrap the inner `processDeliveryStatus` call in a try/catch that swallows "pool ended" errors specifically.

**Why deferred:** Cosmetic, dev/test only. Stub sender is never used in production (real Twilio path doesn't go through `simulateDeliveryCallback`).

**Trigger to promote:** Never, unless it shows up in production logs (it shouldn't — the path is only reachable via `StubSender`).

---

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-04 | Defer all three to end-of-Build hardening pass | All demo-only or scale-only concerns; fixing piecemeal would create inconsistent patterns. Will revisit before first real-customer cutover. |
| 2026-06-08 | Item 1 (Twilio webhook signature validation) completed & verified | Was promoted ahead of the batch when the Toll-Free go-live exposed the API on a public prod domain. Implemented on both webhook routes; verified in code + live prod. Items 2–3 remain deferred. |

## Promotion Checklist

Before going live with a real (non-demo) tenant, complete in this order:
1. [x] Item 1 — Twilio signature validation on **both** webhook routes — DONE 2026-06-08
2. [ ] Item 2 (quick-win variant at minimum) — concurrency cap on scheduler loop
3. [ ] Item 3 — only if it actually shows up in production logs
4. [ ] Re-run full Phase 6 e2e test suite to confirm no regressions
