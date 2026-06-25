import OpenAI from "openai";

/**
 * LLM clients for the two roles in the knowledge hierarchy.
 *
 *  - Professor (heavy, reasoning) — curates knowledge, adjudicates Library
 *    conflicts, and answers real-time escalations. Runs on OpenRouter (Qwen)
 *    via the Replit AI Integrations proxy: no API key of our own, billed to
 *    Replit credits. The proxy speaks the OpenAI chat-completions API, so the
 *    call sites are identical to the old Grok client — only the base URL, key,
 *    and model differ.
 *  - Student (fast, cheap) — drafts replies to inbound chats from the published
 *    Classroom knowledge. Stays on Grok (xAI).
 *
 * Each client returns null when its provider is unconfigured so callers can
 * degrade to a stub instead of throwing (keeps the inbound SMS pipeline alive
 * without secrets).
 */

// --- Student: Grok (xAI), OpenAI-compatible at the xAI base URL ------------
const BASE_URL = "https://api.x.ai/v1";

export const STUDENT_MODEL =
  process.env["SAMA_STUDENT_MODEL"] ?? "grok-4.20-0309-non-reasoning";

let cached: OpenAI | null = null;

export function grokClient(): OpenAI | null {
  const key = process.env["GROK_KEYS"];
  if (!key) return null;
  if (!cached) cached = new OpenAI({ apiKey: key, baseURL: BASE_URL });
  return cached;
}

export function grokConfigured(): boolean {
  return Boolean(process.env["GROK_KEYS"]);
}

// --- Professor: OpenRouter (Qwen) via Replit AI Integrations proxy ----------
// qwen3-max is the flagship NON-thinking tier: high quality without the slow
// extended-reasoning latency of the qwen3.7 "max"/"plus" reasoning variants
// (which run ~10x slower) — the whole point of moving off grok-4.3. Override
// with SAMA_PROFESSOR_MODEL to trade latency for a reasoning model if desired.
export const PROFESSOR_MODEL =
  process.env["SAMA_PROFESSOR_MODEL"] ?? "qwen/qwen3-max";

let cachedProfessor: OpenAI | null = null;

export function professorClient(): OpenAI | null {
  const baseURL = process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"];
  if (!baseURL || !apiKey) return null;
  if (!cachedProfessor) cachedProfessor = new OpenAI({ apiKey, baseURL });
  return cachedProfessor;
}

export function professorConfigured(): boolean {
  return Boolean(
    process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"] &&
      process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"],
  );
}
