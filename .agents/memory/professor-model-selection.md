---
name: Professor model selection (OpenRouter/Qwen)
description: Why the SAMA Professor tier runs on a non-thinking Qwen via OpenRouter, while the Student stays on Grok.
---

# Professor = OpenRouter/Qwen, Student = Grok

The two LLM roles are split across providers. The **Professor** (heavy curation,
Library conflict adjudication, real-time escalation) runs on **OpenRouter (Qwen)**
via the **Replit AI Integrations proxy** (no key of ours, billed to Replit
credits). The **Student** (fast inbound draft replies) stays on **Grok (xAI)**.
The OpenAI-compatible call sites are identical — only the client (base URL + key)
and model differ.

## Default model: a NON-thinking Qwen tier (`qwen/qwen3-max`)

**Why not a higher-numbered Qwen "max"/"plus":** measured through the Replit
OpenRouter proxy, the newer `qwen3.7` max/plus tiers are **reasoning models** —
they emit hidden reasoning tokens and run ~10x slower (~18–20s vs ~2s). Slow
reasoning latency is exactly what we moved off the old reasoning Professor to
escape, so the default is the fast non-thinking flagship. **Why this matters:**
"higher version number" ≠ faster here — always verify latency / reasoning-token
behavior before pinning a Qwen model; don't assume. Override via
`SAMA_PROFESSOR_MODEL` if a future task wants a reasoning tier and can absorb the
latency.

## Test-harness lesson
Tests that simulate "AI offline" by clearing the Student's `GROK_KEYS` must now
ALSO clear the Professor's OpenRouter integration env, or the Professor stays
live and may make real (credit-billed) proxy calls.
