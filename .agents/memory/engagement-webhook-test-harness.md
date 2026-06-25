---
name: Engagement webhook test harness gap
description: Why webhooks.engagement.test.ts "presence" tests fail standalone, and that it is a harness gap — not a product bug or regression.
---

# webhooks.engagement.test.ts "presence" failures are a harness gap

Three "presence" cases in `artifacts/api-server/src/routes/webhooks.engagement.test.ts`
— CO-PILOT stages a `drafted` state, CO-PILOT publishes an `ai:state` event, and
AUTO-PILOT hands back `failed`/`grok_error` — time out at the full ~9s `waitFor`
and FAIL whenever the inbound-AI coalesce window is > 0. The "absence" cases
(manual / manual-override / opt-out, which assert NO state) pass regardless.

**Root cause:** the test imports `../app`, but the worker's 1.5s `setInterval`
poll is only started by `startInboundAiWorker()` in `../index` (server boot). The
only trigger under test is `pokeInboundAiWorker()` fired by the webhook on enqueue
— and it fires immediately, while the staged row's `available_at` =
`now + COALESCE_WINDOW_MS` is still in the future. `claimNextInboundAiStage`
filters `available_at <= now()`, so the poke drains empty and nothing re-drains.
The row is never processed → no AI state → timeout.

**Why it is NOT a regression of the coalesce-window value:** failure is identical
at the original 6000ms and at 2000ms; it only passes with
`SAMA_AI_COALESCE_WINDOW_MS=0` (row available at poke time → all 6 pass). The
window default is irrelevant to these failures.

**How to apply:** don't chase these as a product bug after a latency/coalesce
change. To actually fix the test, either call `startInboundAiWorker()` in the test
setup or set `SAMA_AI_COALESCE_WINDOW_MS=0` for that file. Until then, treat these
3 as a known pre-existing harness failure when running the full api-server suite.
