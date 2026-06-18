import OpenAI from "openai";

/**
 * Grok (xAI) client. The xAI API is OpenAI-compatible, so we reuse the openai
 * SDK pointed at the xAI base URL.
 *
 * Two roles in the LLM hierarchy:
 *  - Professor (heavy, reasoning) — curates knowledge with a human in the loop.
 *  - Student  (fast, cheap)      — drafts replies to inbound chats from the
 *                                  published Classroom knowledge.
 *
 * Returns null when GROK_KEYS is missing so callers can degrade to a stub
 * instead of throwing (keeps the inbound SMS pipeline alive without secrets).
 */

const BASE_URL = "https://api.x.ai/v1";

export const PROFESSOR_MODEL =
  process.env["SAMA_PROFESSOR_MODEL"] ?? "grok-4.3";
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
