import { describe, it, expect } from "vitest";
import {
  evaluateAutoPilotTurn,
  computeAutoPilotFallbackCounts,
  AUTOPILOT_FALLBACK_WINDOW_MS,
  type AutoPilotTurnInput,
  type AutoPilotTurnHistoryItem,
} from "./engagementPolicy";

// A baseline Auto-Pilot turn that produces a grounded answer. Each test clones
// this and flips the fields under test, proving one Gate-Table row at a time.
const BASE: AutoPilotTurnInput = {
  engagementMode: "autopilot",
  knowledgeMatched: true,
  responderErrored: false,
  complianceOk: true,
  humanHandledThisTurn: false,
  consecutiveFallbacks: 0,
  fallbacksInWindow: 0,
};

describe("evaluateAutoPilotTurn — Gate Table rows", () => {
  it("defers when not in autopilot mode (no send, no event)", () => {
    const d = evaluateAutoPilotTurn({ ...BASE, engagementMode: "copilot" });
    expect(d.action).toBe("defer");
    expect(d.outcome).toBeNull();
    expect(d.setOverrideManual).toBe(false);
    expect(d.reasonCode).toBe("mode_not_autopilot");
  });

  it("row 0: compliance block suppresses the AI (audited, not a fallback)", () => {
    const d = evaluateAutoPilotTurn({ ...BASE, complianceOk: false });
    expect(d.action).toBe("suppress");
    expect(d.outcome).toBe("compliance_block");
    expect(d.replyKind).toBe("none");
    expect(d.setOverrideManual).toBe(false);
  });

  it("row 0 beats everything: compliance wins even with knowledge + human", () => {
    const d = evaluateAutoPilotTurn({
      ...BASE,
      complianceOk: false,
      humanHandledThisTurn: true,
      knowledgeMatched: false,
      consecutiveFallbacks: 5,
    });
    expect(d.outcome).toBe("compliance_block");
  });

  it("row 1: human stepped in → defer, no event", () => {
    const d = evaluateAutoPilotTurn({ ...BASE, humanHandledThisTurn: true });
    expect(d.action).toBe("defer");
    expect(d.outcome).toBeNull();
    expect(d.reasonCode).toBe("human_handled");
  });

  it("row 2: knowledge match → grounded answer, stays green", () => {
    const d = evaluateAutoPilotTurn(BASE);
    expect(d.action).toBe("answer");
    expect(d.outcome).toBe("answer");
    expect(d.replyKind).toBe("grounded_answer");
    expect(d.setOverrideManual).toBe(false);
  });

  it("row 3: no match, breaker cold → graceful fallback, stays green", () => {
    const d = evaluateAutoPilotTurn({ ...BASE, knowledgeMatched: false });
    expect(d.action).toBe("fallback");
    expect(d.outcome).toBe("fallback");
    expect(d.replyKind).toBe("fallback_ack");
    expect(d.setOverrideManual).toBe(false);
    expect(d.reasonCode).toBe("out_of_scope");
  });

  it("row 6: responder error → error_fallback (never silent), stays green", () => {
    const d = evaluateAutoPilotTurn({
      ...BASE,
      knowledgeMatched: true,
      responderErrored: true,
    });
    expect(d.action).toBe("fallback");
    expect(d.outcome).toBe("error_fallback");
    expect(d.replyKind).toBe("fallback_ack");
    expect(d.reasonCode).toBe("responder_error");
  });

  it("responder error forces a fallback even when knowledge matched", () => {
    const d = evaluateAutoPilotTurn({ ...BASE, responderErrored: true });
    expect(d.action).toBe("fallback");
    expect(d.outcome).toBe("error_fallback");
  });
});

describe("evaluateAutoPilotTurn — circuit breaker thresholds", () => {
  it("1st and 2nd consecutive fallbacks do NOT step down", () => {
    const first = evaluateAutoPilotTurn({
      ...BASE,
      knowledgeMatched: false,
      consecutiveFallbacks: 0,
    });
    expect(first.action).toBe("fallback");
    const second = evaluateAutoPilotTurn({
      ...BASE,
      knowledgeMatched: false,
      consecutiveFallbacks: 1,
    });
    expect(second.action).toBe("fallback");
    expect(second.setOverrideManual).toBe(false);
  });

  it("row 4: 3rd consecutive fallback steps down to BLUE", () => {
    const d = evaluateAutoPilotTurn({
      ...BASE,
      knowledgeMatched: false,
      consecutiveFallbacks: 2, // this turn makes 3
    });
    expect(d.action).toBe("stepdown");
    expect(d.outcome).toBe("stepdown_consecutive");
    expect(d.replyKind).toBe("final_ack");
    expect(d.setOverrideManual).toBe(true);
    expect(d.stepdownReason).toBe("consecutive");
  });

  it("row 5: >3 in window steps down (4th within window, consecutive reset by answers)", () => {
    const d = evaluateAutoPilotTurn({
      ...BASE,
      knowledgeMatched: false,
      consecutiveFallbacks: 0, // interleaving answers kept the run cold
      fallbacksInWindow: 3, // this turn makes 4 → > limit
    });
    expect(d.action).toBe("stepdown");
    expect(d.outcome).toBe("stepdown_window");
    expect(d.setOverrideManual).toBe(true);
    expect(d.stepdownReason).toBe("window");
  });

  it("exactly 3 in window does NOT trip (rule is strictly >3)", () => {
    const d = evaluateAutoPilotTurn({
      ...BASE,
      knowledgeMatched: false,
      consecutiveFallbacks: 0,
      fallbacksInWindow: 2, // this turn makes 3 → not > 3
    });
    expect(d.action).toBe("fallback");
    expect(d.setOverrideManual).toBe(false);
  });

  it("consecutive limit takes precedence over window when both trip", () => {
    const d = evaluateAutoPilotTurn({
      ...BASE,
      knowledgeMatched: false,
      consecutiveFallbacks: 2, // → 3 consecutive
      fallbacksInWindow: 9, // → 10 in window
    });
    expect(d.outcome).toBe("stepdown_consecutive");
  });

  it("an answer turn never steps down regardless of prior counts", () => {
    const d = evaluateAutoPilotTurn({
      ...BASE,
      knowledgeMatched: true,
      consecutiveFallbacks: 9,
      fallbacksInWindow: 9,
    });
    expect(d.action).toBe("answer");
    expect(d.setOverrideManual).toBe(false);
  });
});

describe("computeAutoPilotFallbackCounts", () => {
  const now = new Date("2026-06-27T12:00:00.000Z");
  const at = (secondsAgo: number) =>
    new Date(now.getTime() - secondsAgo * 1000);

  const ev = (
    outcome: string,
    secondsAgo: number,
  ): AutoPilotTurnHistoryItem => ({ outcome, createdAt: at(secondsAgo) });

  it("empty history → zero counts", () => {
    expect(computeAutoPilotFallbackCounts([], now)).toEqual({
      consecutive: 0,
      inWindow: 0,
    });
  });

  it("counts a trailing run of fallbacks (newest first)", () => {
    const counts = computeAutoPilotFallbackCounts(
      [ev("fallback", 5), ev("error_fallback", 20), ev("answer", 40)],
      now,
    );
    expect(counts.consecutive).toBe(2);
    expect(counts.inWindow).toBe(2);
  });

  it("an answer resets the consecutive run but window still counts older fallbacks", () => {
    const counts = computeAutoPilotFallbackCounts(
      [ev("answer", 5), ev("fallback", 20), ev("fallback", 30)],
      now,
    );
    expect(counts.consecutive).toBe(0); // newest is an answer
    expect(counts.inWindow).toBe(2); // both fallbacks still inside 2 min
  });

  it("compliance_block is neutral — does not reset or count", () => {
    const counts = computeAutoPilotFallbackCounts(
      [ev("fallback", 5), ev("compliance_block", 10), ev("fallback", 15)],
      now,
    );
    expect(counts.consecutive).toBe(2);
    expect(counts.inWindow).toBe(2);
  });

  it("fallbacks older than the 2-min window are excluded from inWindow", () => {
    const counts = computeAutoPilotFallbackCounts(
      [ev("fallback", 10), ev("fallback", 200)], // 200s > 120s window
      now,
    );
    expect(counts.consecutive).toBe(2); // consecutive is not time-bound
    expect(counts.inWindow).toBe(1);
  });

  it("a prior stepdown is a fresh-start boundary for both tallies", () => {
    // After a stepdown (blue) a human re-enabled autopilot; the newest event is
    // the stepdown, so the next turn must see a clean slate.
    const counts = computeAutoPilotFallbackCounts(
      [ev("stepdown_consecutive", 5), ev("fallback", 10), ev("fallback", 15)],
      now,
    );
    expect(counts.consecutive).toBe(0);
    expect(counts.inWindow).toBe(0);
  });

  it("respects a custom window size", () => {
    const counts = computeAutoPilotFallbackCounts(
      [ev("fallback", 30), ev("fallback", 90)],
      now,
      60 * 1000, // 1-min window
    );
    expect(counts.inWindow).toBe(1);
    expect(AUTOPILOT_FALLBACK_WINDOW_MS).toBe(120000);
  });
});
