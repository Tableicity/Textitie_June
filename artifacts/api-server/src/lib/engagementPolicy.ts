import type { FactCategory } from "./knowledge";
import type { StudentConfidence } from "@workspace/ai-student";

/**
 * B4 — per-tenant engagement mode + the pure gate that decides whether the
 * Student is allowed to AUTO-SEND an SMS reply (vs. only drafting a private
 * whisper for the agent).
 *
 * `evaluateAutoSend` is intentionally side-effect-free and exhaustively gated so
 * it can be unit-tested in isolation. The webhook computes each input (draft
 * signals, retrieval grounding, conflict state, compliance) and this function is
 * the single place that ANDs them together. Auto-send is fail-closed: any gate
 * that is unknown or unsafe blocks the send and we fall back to the whisper.
 */

export const ENGAGEMENT_MODES = ["assisted", "gated_auto"] as const;
export type EngagementMode = (typeof ENGAGEMENT_MODES)[number];

/** Coerce any stored/posted value to a known mode; unknown ⇒ "assisted". */
export function normalizeEngagementMode(raw: unknown): EngagementMode {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (ENGAGEMENT_MODES as readonly string[]).includes(v)
    ? (v as EngagementMode)
    : "assisted";
}

// Categories whose ANSWERS are safe to auto-send without a human in the loop.
// Pricing, compliance, and technical_setup are high-stakes (money, legal,
// breakage) and always require an agent.
const SAFE_AUTO_CATEGORIES: ReadonlySet<FactCategory> = new Set<FactCategory>([
  "general",
  "features",
]);

// Risky inbound INTENTS. If the customer's message itself reads as one of these
// we never auto-send — even when the grounding facts look benign — because the
// fact classifier can under-tag and we would rather under-automate than send a
// wrong pricing/compliance/setup answer.
const RISKY_QUERY_CATEGORIES: ReadonlySet<FactCategory> = new Set<FactCategory>([
  "pricing",
  "compliance",
  "technical_setup",
]);

export type AutoSendInput = {
  engagementMode: EngagementMode;
  draftStatus: "stubbed" | "drafted" | "failed";
  confidence: StudentConfidence | null;
  kbMatched: boolean;
  groundedInClassroom: boolean;
  /** The classified intent of the inbound message (null when unclassified). */
  queryCategory: FactCategory | null;
  /** Categories of the Classroom facts actually retrieved for grounding. */
  groundingCategories: FactCategory[];
  /** True when an unresolved conflict touches the relevant categories. */
  hasConflict: boolean;
  /** Result of checkOutboundCompliance run at decision time. */
  complianceOk: boolean;
};

export type AutoSendDecision = { autoSend: boolean; reasons: string[] };

/**
 * Decide whether to auto-send. Returns autoSend=true ONLY when every gate
 * passes; otherwise `reasons` lists every failed gate (useful for logs/audit).
 */
export function evaluateAutoSend(input: AutoSendInput): AutoSendDecision {
  const reasons: string[] = [];

  if (input.engagementMode !== "gated_auto") reasons.push("mode_not_gated_auto");
  if (input.draftStatus !== "drafted") reasons.push("draft_not_ready");
  // Grounding must come from the curated Classroom — never the legacy blob/stub.
  if (!input.groundedInClassroom) reasons.push("not_grounded_in_classroom");
  // Model confidence is advisory but required to be explicitly "high".
  if (input.confidence !== "high") reasons.push("confidence_not_high");
  // The answer must actually quote the Classroom (not a freehand guess).
  if (!input.kbMatched) reasons.push("no_kb_match");
  // A risky inbound intent always blocks, regardless of grounding.
  if (input.queryCategory && RISKY_QUERY_CATEGORIES.has(input.queryCategory)) {
    reasons.push("risky_query_category");
  }
  // Require grounding facts to exist AND all be in a safe category. An empty set
  // means we are not actually grounded → block (null query category alone is
  // NOT treated as safe).
  if (input.groundingCategories.length === 0) {
    reasons.push("no_grounding_facts");
  } else if (!input.groundingCategories.every((c) => SAFE_AUTO_CATEGORIES.has(c))) {
    reasons.push("unsafe_grounding_category");
  }
  if (input.hasConflict) reasons.push("unresolved_conflict");
  if (!input.complianceOk) reasons.push("compliance_block");

  return { autoSend: reasons.length === 0, reasons };
}
