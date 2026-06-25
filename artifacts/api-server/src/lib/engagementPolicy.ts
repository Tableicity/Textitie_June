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

export const ENGAGEMENT_MODES = ["manual", "copilot", "autopilot"] as const;
export type EngagementMode = (typeof ENGAGEMENT_MODES)[number];

// Legacy stored values → canonical modes (no data migration needed).
const LEGACY_MODE_ALIASES: Record<string, EngagementMode> = {
  assisted: "copilot",
  gated_auto: "autopilot",
};

/**
 * Coerce any stored/posted value to a canonical mode. Accepts the new modes
 * (manual|copilot|autopilot) and the legacy aliases (assisted→copilot,
 * gated_auto→autopilot). Anything unknown ⇒ "copilot" (safe: drafts only,
 * never auto-sends, never learns).
 */
export function normalizeEngagementMode(raw: unknown): EngagementMode {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if ((ENGAGEMENT_MODES as readonly string[]).includes(v)) {
    return v as EngagementMode;
  }
  return LEGACY_MODE_ALIASES[v] ?? "copilot";
}

/**
 * Resolve the mode that actually governs a conversation: a per-conversation
 * override wins over the tenant default; a null/empty override inherits the
 * tenant. Both inputs are normalized (legacy aliases honored).
 */
export function resolveEffectiveEngagementMode(
  conversationOverride: unknown,
  tenantMode: unknown,
): EngagementMode {
  const hasOverride =
    typeof conversationOverride === "string" &&
    conversationOverride.trim() !== "";
  return hasOverride
    ? normalizeEngagementMode(conversationOverride)
    : normalizeEngagementMode(tenantMode);
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
  /**
   * True when retrieval found a real FTS lexical hit in the Classroom (every
   * non-stopword term present in a fact). A deterministic grounding signal,
   * stronger than the Student's brittle self-report, so when set it satisfies
   * the grounding / confidence / kbMatch gates. It NEVER relaxes the safety
   * floors (category, risky-intent, conflict, compliance). Optional; default
   * false.
   */
  strongClassroomMatch?: boolean;
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

  if (input.engagementMode !== "autopilot") reasons.push("mode_not_autopilot");
  if (input.draftStatus !== "drafted") reasons.push("draft_not_ready");
  // A real FTS hit is a deterministic grounding signal — stronger than the
  // Student's self-report — so it satisfies the three model-self-report gates
  // below (grounding / confidence / kbMatch). It NEVER satisfies the safety
  // floors that follow (category, risky-intent, conflict, compliance).
  const fts = input.strongClassroomMatch === true;
  // Grounding must come from the curated Classroom — never the legacy blob/stub.
  if (!input.groundedInClassroom && !fts)
    reasons.push("not_grounded_in_classroom");
  // Model confidence is advisory but required to be explicitly "high".
  if (input.confidence !== "high" && !fts) reasons.push("confidence_not_high");
  // The answer must actually quote the Classroom (not a freehand guess).
  if (!input.kbMatched && !fts) reasons.push("no_kb_match");
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

// Friendly, customer-agent-facing text for each gate-refusal reason code, in
// priority order. When Auto-Pilot hands a message back to a human (Blue) we show
// ONE short chip explaining why — the most important reason wins.
const HANDBACK_REASON_TEXT: Array<[string, string]> = [
  ["grok_error", "AI couldn't draft a reply"],
  ["send_failed", "Auto-send failed — please send manually"],
  ["compliance_block", "Compliance hold — needs your review"],
  ["risky_query_category", "Sensitive topic — needs a human"],
  ["unsafe_grounding_category", "Sensitive topic — needs a human"],
  ["unsafe_escalated_category", "Sensitive topic — needs a human"],
  ["unresolved_conflict", "Conflicting knowledge — needs your review"],
  ["confidence_not_high", "Not confident enough to auto-send"],
  ["no_kb_match", "No matching knowledge"],
  ["not_grounded_in_classroom", "No matching knowledge"],
  ["no_grounding_facts", "No matching knowledge"],
  ["no_screened_facts", "No matching knowledge"],
  ["no_escalated_categories", "No matching knowledge"],
  ["draft_not_ready", "AI couldn't draft a reply"],
  ["escalation_not_answered", "AI couldn't draft a reply"],
  ["grok_offline", "AI is offline"],
];

/**
 * Pick the single most important human-readable chip text for a Blue handback,
 * given the machine reason codes the gate produced. Falls back to a generic
 * "Needs your review" when nothing matches.
 */
export function describeHandbackReason(reasons: string[]): string {
  const set = new Set(reasons);
  for (const [code, text] of HANDBACK_REASON_TEXT) {
    if (set.has(code)) return text;
  }
  return "Needs your review";
}

export type EscalationSendInput = {
  engagementMode: EngagementMode;
  grokConfigured: boolean;
  escalationStatus: "answered" | "stubbed" | "failed";
  confidence: "high" | "medium" | "low" | null;
  /**
   * Count of screened facts that WOULD be persisted. The gate runs BEFORE
   * persistence — facts are only written after a confirmed autonomous send.
   */
  screenedFactCount: number;
  /** True when the escalation produced a non-empty customer reply. */
  hasReply: boolean;
  /** Categories of the persisted escalation facts. */
  escalatedCategories: FactCategory[];
  /** Classified intent of the inbound message (null when unclassified). */
  queryCategory: FactCategory | null;
  hasConflict: boolean;
  complianceOk: boolean;
  automationHandled: boolean;
};

/**
 * Dedicated gate for AUTO-SENDING an autonomous-Professor escalation answer.
 *
 * The Professor generated fresh grounding, so this bypasses the Student's
 * KB/category/grounding gate — but it must NOT bypass the safety floors: the
 * escalated facts must ALL be in a SAFE category (high-stakes pricing /
 * compliance / technical_setup answers are learned but only DRAFTED for a
 * human), there must be no unresolved conflict touching them, telephony
 * compliance must pass, and the Professor must be explicitly "high" confidence.
 * Fail-closed, exactly like evaluateAutoSend.
 */
export function evaluateProfessorEscalationSend(
  input: EscalationSendInput,
): AutoSendDecision {
  const reasons: string[] = [];

  if (input.engagementMode !== "autopilot") reasons.push("mode_not_autopilot");
  if (input.automationHandled) reasons.push("automation_handled");
  if (!input.grokConfigured) reasons.push("grok_offline");
  if (input.escalationStatus !== "answered") reasons.push("escalation_not_answered");
  if (input.confidence !== "high") reasons.push("confidence_not_high");
  if (input.screenedFactCount < 1) reasons.push("no_screened_facts");
  if (!input.hasReply) reasons.push("no_reply_text");
  if (input.escalatedCategories.length === 0) {
    reasons.push("no_escalated_categories");
  } else if (
    !input.escalatedCategories.every((c) => SAFE_AUTO_CATEGORIES.has(c))
  ) {
    reasons.push("unsafe_escalated_category");
  }
  // A risky inbound INTENT always blocks, independent of how the Professor
  // categorized its facts — the fact classifier can under-tag, and we will not
  // auto-send a pricing/compliance/setup answer just because facts read benign.
  if (input.queryCategory && RISKY_QUERY_CATEGORIES.has(input.queryCategory)) {
    reasons.push("risky_query_category");
  }
  if (input.hasConflict) reasons.push("unresolved_conflict");
  if (!input.complianceOk) reasons.push("compliance_block");

  return { autoSend: reasons.length === 0, reasons };
}
