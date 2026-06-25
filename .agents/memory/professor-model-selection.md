---
name: Professor model selection (OpenRouter/Qwen)
description: Why the Professor tier runs on qwen/qwen3-max (non-thinking) and not the newer qwen3.7 "max"/"plus" reasoning variants.
---

# Professor LLM = OpenRouter (Qwen), Student stays on Grok

The two LLM roles are split across providers: the **Professor** (heavy curation,
Library conflict adjudication, real-time escalation) runs on **OpenRouter via the
Replit AI Integrations proxy**; the **Student** (fast inbound drafts) stays on
**Grok (xAI)**. The OpenAI SDK call sites are identical across both — only the
client (base URL + key) and model differ. Professor client/guard:
`professorClient()` / `professorConfigured()` keyed on
`AI_INTEGRATIONS_OPENROUTER_BASE_URL` + `_API_KEY`. Student keeps
`grokClient()` / `grokConfigured()` keyed on `GROK_KEYS`.

## Pinned model: `qwen/qwen3-max` (override `SAMA_PROFESSOR_MODEL`)

**Why not the newer/higher-numbered Qwen "max"/"plus":** measured through the
Replit OpenRouter proxy, `qwen/qwen3.7-max` (~18.8s) and `qwen/qwen3.7-plus`
(~20.6s) are **reasoning models** — they emit hundreds of hidden reasoning
tokens and are ~10x slower, which is exactly the slow-reasoning latency we moved
off `grok-4.3` to escape. `qwen/qwen3-max` is the flagship **non-thinking** tier:
~1.9s, clean compact JSON, 0 reasoning tokens, ~15x cheaper. "Higher version
number" ≠ faster here; verify latency/reasoning-token behavior before pinning a
Qwen model, don't assume.

**How to apply:** if a future task wants max Professor capability and can absorb
the latency, set `SAMA_PROFESSOR_MODEL=qwen/qwen3.7-max` (or `-plus`) — no code
change. Keep the default non-thinking.

## Test-harness note
Tests that simulate "AI offline" by deleting `GROK_KEYS` must ALSO delete the
OpenRouter env vars now, or the Professor stays live (and may make real proxy
calls). See `webhooks.engagement.test.ts` setup.
