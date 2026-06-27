import type { RouteBranch } from "@workspace/ai-router";

/**
 * B4 — per-tenant engagement mode helpers + the pure Auto-Pilot gate table.
 *
 * Owns the canonical engagement modes (manual|copilot|autopilot) with their
 * normalization/resolution helpers, the Blue-handback reason text, the
 * triage-router branch invariant, and the fail-OPEN Auto-Pilot turn gate
 * (`evaluateAutoPilotTurn`) plus its circuit-breaker tally
 * (`computeAutoPilotFallbackCounts`). Everything here is side-effect-free and
 * exhaustively unit-tested in isolation.
 *
 * NOTE: the legacy fail-CLOSED per-message gates (`evaluateAutoSend` /
 * `evaluateProfessorEscalationSend`) were removed 2026-06-27 along with the dead
 * legacy Auto-Pilot branch and the live Professor escalation path. The live
 * Auto-Pilot model is the conversational fail-OPEN gate table below.
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
  ["professor_offline", "AI is offline"],
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

// ---------------------------------------------------------------------------
// Triage-router branch safety invariant (Co-Pilot router; Auto-Pilot deferred).
//
// The Co-Pilot triage router can short-circuit an inbound into one of two
// advisory, DRAFT-ONLY branches that are NEVER Classroom-grounded:
//   - "out_of_scope"     → an LLM-authored decline, and
//   - "general_in_scope" → an ungrounded Grok "flash" answer.
// Neither produces curated facts, so neither may EVER auto-send or be learned in
// ANY engagement mode. Only "tenant_specific" (the grounded Classroom → Professor
// pipeline) is ever eligible for auto-send/learning.
//
// Today the router runs for Co-Pilot ONLY, which never auto-sends or learns at
// all, so the two ungrounded branches are structurally unreachable from any
// send/persist path (they short-circuit with a draft + return). This predicate
// is the EXPLICIT seam the deferred Auto-Pilot router task MUST consult: before
// any auto-send/learn decision on a routed turn, gate on
// isRouterBranchAutoSendable(branch) so the ungrounded branches can never reach
// the send/persist path even when the router is wired into Auto-Pilot.
// ---------------------------------------------------------------------------
export function isRouterBranchAutoSendable(branch: RouteBranch): boolean {
  return branch === "tenant_specific";
}

// ===========================================================================
// Auto-Pilot conversational "Gate Table" — fail-OPEN responder + circuit breaker
//
// Auto-Pilot is FAIL-OPEN and CONVERSATIONAL: every inbound gets a turn —
// either a grounded answer or a graceful out-of-scope acknowledgement — so the
// conversation never stalls. The ONLY stop is a deterministic circuit breaker
// on repeated fallbacks.
//
// IMPORTANT: this path is closed-book and provenance-gated — Auto-Pilot answers
// ONLY from the approved Classroom index (no live Professor escalation, no
// learning). The topic-based "risky category" rails do NOT apply here (if the
// knowledge is approved it is answerable). The only hard guard is compliance /
// opt-out, which is absolute and re-checked again at send time. Co-Pilot and
// Manual do NOT use this gate.
// ===========================================================================

export const AUTOPILOT_TURN_OUTCOMES = [
  "answer",
  "fallback",
  "error_fallback",
  "stepdown_consecutive",
  "stepdown_window",
  "compliance_block",
] as const;
export type AutopilotTurnOutcome = (typeof AUTOPILOT_TURN_OUTCOMES)[number];

// Outcomes that represent an UNANSWERED turn and increment the breaker tally.
export const AUTOPILOT_FALLBACK_OUTCOMES: ReadonlySet<AutopilotTurnOutcome> =
  new Set<AutopilotTurnOutcome>(["fallback", "error_fallback"]);
// Outcomes that bound the trailing run: a successful answer, or a prior stepdown
// after which a human re-enabled Auto-Pilot — either way, start fresh.
export const AUTOPILOT_RUN_BOUNDARY_OUTCOMES: ReadonlySet<AutopilotTurnOutcome> =
  new Set<AutopilotTurnOutcome>([
    "answer",
    "stepdown_consecutive",
    "stepdown_window",
  ]);

// Step down GREEN→BLUE on the Nth consecutive fallback...
export const AUTOPILOT_CONSECUTIVE_FALLBACK_LIMIT = 3;
// ...or when MORE THAN this many fallbacks land within the rolling window.
export const AUTOPILOT_WINDOW_FALLBACK_LIMIT = 3;
// Rolling window for the burst rule (2 minutes).
export const AUTOPILOT_FALLBACK_WINDOW_MS = 2 * 60 * 1000;

export type AutoPilotTurnInput = {
  engagementMode: EngagementMode;
  /** True when retrieval found an approved Classroom match (fts|coverage w/ facts). */
  knowledgeMatched: boolean;
  /** True when the responder/LLM failed to produce a usable reply. */
  responderErrored: boolean;
  /** Outbound compliance check at decision time (re-checked again at send). */
  complianceOk: boolean;
  /** True when a human already took this turn (defer; no AI send, no event). */
  humanHandledThisTurn: boolean;
  /** Trailing consecutive fallback-class turns BEFORE this turn. */
  consecutiveFallbacks: number;
  /** Fallback-class turns within the rolling window BEFORE this turn. */
  fallbacksInWindow: number;
};

export type AutoPilotTurnAction =
  | "answer"
  | "fallback"
  | "stepdown"
  | "suppress"
  | "defer";
export type AutoPilotReplyKind =
  | "grounded_answer"
  | "fallback_ack"
  | "final_ack"
  | "none";

export type AutoPilotTurnDecision = {
  action: AutoPilotTurnAction;
  /** Canonical event to record; null ⇒ record nothing (defer). */
  outcome: AutopilotTurnOutcome | null;
  replyKind: AutoPilotReplyKind;
  reasonCode: string;
  /** True ⇒ flip the conversation's engagementModeOverride to "manual" (BLUE). */
  setOverrideManual: boolean;
  stepdownReason?: "consecutive" | "window";
};

/**
 * Decide what Auto-Pilot does for a single inbound turn. Pure + total so it can
 * be unit-tested exhaustively. Rows are evaluated top-down, first match wins —
 * matching the published Gate Table.
 *
 * The caller supplies the PRIOR fallback tallies (counts BEFORE this turn); this
 * function adds the current turn on top to decide whether the breaker trips.
 */
export function evaluateAutoPilotTurn(
  input: AutoPilotTurnInput,
): AutoPilotTurnDecision {
  // Defensive guard: only Auto-Pilot turns are routed here. Anything else
  // defers with no send and no recorded event.
  if (input.engagementMode !== "autopilot") {
    return {
      action: "defer",
      outcome: null,
      replyKind: "none",
      reasonCode: "mode_not_autopilot",
      setOverrideManual: false,
    };
  }

  // Row 0 — hard compliance/opt-out guard ALWAYS wins. Suppress the AI. Recorded
  // for audit but neutral to the breaker (a legal hold is not a knowledge miss).
  if (!input.complianceOk) {
    return {
      action: "suppress",
      outcome: "compliance_block",
      replyKind: "none",
      reasonCode: "compliance_block",
      setOverrideManual: false,
    };
  }

  // Row 1 — a human already took this turn; AI defers. No send, no event.
  if (input.humanHandledThisTurn) {
    return {
      action: "defer",
      outcome: null,
      replyKind: "none",
      reasonCode: "human_handled",
      setOverrideManual: false,
    };
  }

  // Row 2 — grounded answer available: stitch + send. Recording an `answer`
  // resets the consecutive run for future turns.
  if (input.knowledgeMatched && !input.responderErrored) {
    return {
      action: "answer",
      outcome: "answer",
      replyKind: "grounded_answer",
      reasonCode: "answered",
      setOverrideManual: false,
    };
  }

  // Rows 3-6 — fallback-class turn. Tally THIS turn on top of the prior counts.
  const nextConsecutive = input.consecutiveFallbacks + 1;
  const nextWindow = input.fallbacksInWindow + 1;

  // Row 4 — Nth consecutive fallback ⇒ step down to BLUE (final ack + manual).
  if (nextConsecutive >= AUTOPILOT_CONSECUTIVE_FALLBACK_LIMIT) {
    return {
      action: "stepdown",
      outcome: "stepdown_consecutive",
      replyKind: "final_ack",
      reasonCode: "consecutive_fallbacks",
      setOverrideManual: true,
      stepdownReason: "consecutive",
    };
  }

  // Row 5 — MORE THAN the limit within the rolling window ⇒ step down to BLUE.
  if (nextWindow > AUTOPILOT_WINDOW_FALLBACK_LIMIT) {
    return {
      action: "stepdown",
      outcome: "stepdown_window",
      replyKind: "final_ack",
      reasonCode: "fallback_burst",
      setOverrideManual: true,
      stepdownReason: "window",
    };
  }

  // Row 6 — responder/LLM error ⇒ graceful fallback ack (never silent).
  if (input.responderErrored) {
    return {
      action: "fallback",
      outcome: "error_fallback",
      replyKind: "fallback_ack",
      reasonCode: "responder_error",
      setOverrideManual: false,
    };
  }

  // Row 3 — no match: graceful out-of-scope ack; conversation CONTINUES (GREEN).
  return {
    action: "fallback",
    outcome: "fallback",
    replyKind: "fallback_ack",
    reasonCode: "out_of_scope",
    setOverrideManual: false,
  };
}

export type AutoPilotTurnHistoryItem = { outcome: string; createdAt: Date };
export type AutoPilotFallbackCounts = { consecutive: number; inWindow: number };

/**
 * Compute the breaker tallies from a conversation's recent Auto-Pilot turn
 * history (newest-first). Pure so the time/boundary rules are unit-testable
 * without a DB; the store layer just fetches rows and delegates here.
 *
 *  - consecutive: trailing `fallback`/`error_fallback` turns, scanning newest→
 *    oldest, stopping at the first run boundary (`answer` or a `stepdown_*`).
 *    `compliance_block` is neutral (skipped, scan continues).
 *  - inWindow: `fallback`/`error_fallback` turns within `windowMs` of `now`,
 *    stopping at a `stepdown_*` (a prior stepdown = re-enable boundary) or the
 *    time edge. `answer`/`compliance_block` inside the window are neutral.
 */
export function computeAutoPilotFallbackCounts(
  eventsNewestFirst: AutoPilotTurnHistoryItem[],
  now: Date,
  windowMs: number = AUTOPILOT_FALLBACK_WINDOW_MS,
): AutoPilotFallbackCounts {
  let consecutive = 0;
  for (const ev of eventsNewestFirst) {
    const o = ev.outcome;
    if (o === "answer" || o === "stepdown_consecutive" || o === "stepdown_window") {
      break;
    }
    if (o === "fallback" || o === "error_fallback") consecutive += 1;
    // compliance_block / unknown → neutral, keep scanning.
  }

  let inWindow = 0;
  const windowStart = now.getTime() - windowMs;
  for (const ev of eventsNewestFirst) {
    if (ev.createdAt.getTime() < windowStart) break; // older than the window
    const o = ev.outcome;
    if (o === "stepdown_consecutive" || o === "stepdown_window") break; // re-enable boundary
    if (o === "fallback" || o === "error_fallback") inWindow += 1;
    // answer / compliance_block within window → neutral.
  }

  return { consecutive, inWindow };
}
