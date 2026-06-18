import OpenAI from "openai";
import type { Tenant } from "@workspace/db";

/**
 * SAMA "AI Student" — drafts a Private Note (Whisper) for the human agent
 * within ~2s of an inbound message arriving.
 *
 * The Student is the cheap/fast tier of the LLM hierarchy. It reads the
 * tenant's **published Classroom** knowledge (curated by the Professor and
 * retrieved by the caller via full-text search) for RAG-lite grounding. If no
 * Classroom has been published yet, it falls back to the legacy
 * tenant.knowledge_base blob so existing tenants keep working.
 *
 * STUBBED when GROK_KEYS is missing — returns a synthetic draft so the pipeline
 * keeps flowing without secrets.
 */

const BASE_URL = "https://api.x.ai/v1";

export type StudentDraft = {
  status: "stubbed" | "drafted" | "failed";
  whisperBody: string;
  detail: string;
  latencyMs: number;
};

let cachedClient: OpenAI | null = null;
function client(): OpenAI | null {
  const key = process.env["GROK_KEYS"];
  if (!key) return null;
  if (!cachedClient) cachedClient = new OpenAI({ apiKey: key, baseURL: BASE_URL });
  return cachedClient;
}

const MODEL =
  process.env["SAMA_STUDENT_MODEL"] ?? "grok-4.20-0309-non-reasoning";

const SYSTEM_PROMPT = `You are the SAMA Student Assistant — a junior helper for a human customer-support agent.

You will receive (1) the tenant's published Classroom knowledge and (2) a single inbound customer SMS.

Produce ONE concise Private Note (under 600 chars) with three sections, marked exactly:
SUMMARY: one sentence, intent of the message.
DRAFT REPLY: a polite SMS-length draft the human agent can send (no signature, no greetings if redundant).
KB MATCH: if the customer's question is directly answered by the Classroom knowledge, quote the answer in one sentence and prefix with "KB:". Otherwise write "KB: none".

Be terse. The human agent is busy. Do not use markdown. Plain text only.`;

export async function studentWhisper(opts: {
  tenant: Tenant;
  fromNumber: string;
  inboundBody: string;
  /**
   * Published Classroom knowledge retrieved by the caller (FTS over
   * classroom_facts). When empty, the Student falls back to the tenant's
   * legacy knowledge_base blob.
   */
  classroomContext?: string;
}): Promise<StudentDraft> {
  const start = Date.now();
  const oai = client();
  if (!oai) {
    return {
      status: "stubbed",
      whisperBody: `[SAMA Student — STUBBED]\nSUMMARY: (no GROK_KEYS set)\nDRAFT REPLY: (AI Student offline — agent must reply manually)\nKB: none`,
      detail: "GROK_KEYS not set",
      latencyMs: Date.now() - start,
    };
  }

  const classroom = (opts.classroomContext ?? "").trim();
  const legacy = (opts.tenant.knowledgeBase ?? "").trim();
  const knowledge = classroom.length > 0 ? classroom : legacy;
  const knowledgeSource =
    classroom.length > 0
      ? "PUBLISHED CLASSROOM"
      : legacy.length > 0
        ? "LEGACY KNOWLEDGE BASE"
        : "NONE";

  const userPrompt = [
    `TENANT: ${opts.tenant.name} (${opts.tenant.slug})`,
    `KNOWLEDGE SOURCE: ${knowledgeSource}`,
    `CLASSROOM KNOWLEDGE:`,
    knowledge.length > 0
      ? knowledge
      : "(empty — no Classroom published and no legacy KB for this tenant)",
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
        detail: "Grok returned empty content",
        latencyMs: Date.now() - start,
      };
    }
    return {
      status: "drafted",
      whisperBody: `[SAMA Student — ${MODEL}]\n${text}`,
      detail: `model=${MODEL} source=${knowledgeSource} tokens=${resp.usage?.total_tokens ?? "?"}`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "failed",
      whisperBody: `[SAMA Student] error: ${msg}`,
      detail: `Grok exception: ${msg}`,
      latencyMs: Date.now() - start,
    };
  }
}
