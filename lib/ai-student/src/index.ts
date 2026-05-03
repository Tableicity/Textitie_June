import OpenAI from "openai";
import type { Tenant } from "@workspace/db";

/**
 * SAMA "AI Student" — drafts a Private Note (Whisper) for the human agent
 * within ~2s of an inbound message arriving. Reads the tenant knowledge_base
 * for RAG-lite grounding.
 *
 * STUBBED when OPENAI_API_KEY is missing — returns a synthetic draft so the
 * pipeline keeps flowing without secrets.
 */

export type StudentDraft = {
  status: "stubbed" | "drafted" | "failed";
  whisperBody: string;
  detail: string;
  latencyMs: number;
};

let cachedClient: OpenAI | null = null;
function client(): OpenAI | null {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) return null;
  if (!cachedClient) cachedClient = new OpenAI({ apiKey: key });
  return cachedClient;
}

const MODEL = process.env["SAMA_STUDENT_MODEL"] ?? "gpt-4o-mini";
const SYSTEM_PROMPT = `You are the SAMA Student Assistant — a junior helper for a human customer-support agent.

You will receive (1) a tenant knowledge base and (2) a single inbound customer SMS.

Produce ONE concise Private Note (under 600 chars) with three sections, marked exactly:
SUMMARY: one sentence, intent of the message.
DRAFT REPLY: a polite SMS-length draft the human agent can send (no signature, no greetings if redundant).
KB MATCH: if the customer's question is directly answered by the knowledge base, quote the answer in one sentence and prefix with "KB:". Otherwise write "KB: none".

Be terse. The human agent is busy. Do not use markdown. Plain text only.`;

export async function studentWhisper(opts: {
  tenant: Tenant;
  fromNumber: string;
  inboundBody: string;
}): Promise<StudentDraft> {
  const start = Date.now();
  const oai = client();
  if (!oai) {
    return {
      status: "stubbed",
      whisperBody: `[SAMA Student — STUBBED]\nSUMMARY: (no OPENAI_API_KEY set)\nDRAFT REPLY: (AI Student offline — agent must reply manually)\nKB: none`,
      detail: "OPENAI_API_KEY not set",
      latencyMs: Date.now() - start,
    };
  }

  const kb = (opts.tenant.knowledgeBase ?? "").trim();
  const userPrompt = [
    `TENANT: ${opts.tenant.name} (${opts.tenant.slug})`,
    `KNOWLEDGE BASE:`,
    kb.length > 0 ? kb : "(empty — no KB configured for this tenant)",
    ``,
    `INBOUND SMS FROM ${opts.fromNumber}:`,
    opts.inboundBody,
  ].join("\n");

  try {
    const resp = await oai.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 250,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
    const text = resp.choices[0]?.message?.content?.trim() ?? "";
    if (!text) {
      return {
        status: "failed",
        whisperBody: "[SAMA Student] (empty response from model)",
        detail: "OpenAI returned empty content",
        latencyMs: Date.now() - start,
      };
    }
    return {
      status: "drafted",
      whisperBody: `[SAMA Student — ${MODEL}]\n${text}`,
      detail: `model=${MODEL} tokens=${resp.usage?.total_tokens ?? "?"}`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "failed",
      whisperBody: `[SAMA Student] error: ${msg}`,
      detail: `OpenAI exception: ${msg}`,
      latencyMs: Date.now() - start,
    };
  }
}
