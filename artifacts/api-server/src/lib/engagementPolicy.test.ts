import { describe, it, expect } from "vitest";
import {
  normalizeEngagementMode,
  resolveEffectiveEngagementMode,
  evaluateAutoSend,
  evaluateProfessorEscalationSend,
  type AutoSendInput,
  type EscalationSendInput,
} from "./engagementPolicy";

// A fully-passing input. Every gate test below clones this and flips ONE field
// so we prove each gate independently blocks the send.
const HAPPY: AutoSendInput = {
  engagementMode: "autopilot",
  draftStatus: "drafted",
  confidence: "high",
  kbMatched: true,
  groundedInClassroom: true,
  queryCategory: "general",
  groundingCategories: ["general", "features"],
  hasConflict: false,
  complianceOk: true,
};

describe("normalizeEngagementMode", () => {
  it("passes through canonical modes", () => {
    expect(normalizeEngagementMode("manual")).toBe("manual");
    expect(normalizeEngagementMode("copilot")).toBe("copilot");
    expect(normalizeEngagementMode("autopilot")).toBe("autopilot");
  });

  it("maps legacy aliases to canonical modes (no data migration)", () => {
    expect(normalizeEngagementMode("assisted")).toBe("copilot");
    expect(normalizeEngagementMode("gated_auto")).toBe("autopilot");
  });

  it("is case/whitespace tolerant", () => {
    expect(normalizeEngagementMode("  AUTOPILOT ")).toBe("autopilot");
    expect(normalizeEngagementMode("Assisted")).toBe("copilot");
    expect(normalizeEngagementMode(" Gated_Auto ")).toBe("autopilot");
  });

  it("defaults unknown/empty/non-string to copilot (safe: drafts only)", () => {
    expect(normalizeEngagementMode("auto")).toBe("copilot");
    expect(normalizeEngagementMode("")).toBe("copilot");
    expect(normalizeEngagementMode(null)).toBe("copilot");
    expect(normalizeEngagementMode(undefined)).toBe("copilot");
    expect(normalizeEngagementMode(42)).toBe("copilot");
  });
});

describe("resolveEffectiveEngagementMode", () => {
  it("uses the conversation override when present", () => {
    expect(resolveEffectiveEngagementMode("manual", "autopilot")).toBe("manual");
    expect(resolveEffectiveEngagementMode("autopilot", "copilot")).toBe("autopilot");
  });

  it("inherits the tenant mode when the override is null/empty", () => {
    expect(resolveEffectiveEngagementMode(null, "autopilot")).toBe("autopilot");
    expect(resolveEffectiveEngagementMode("", "manual")).toBe("manual");
    expect(resolveEffectiveEngagementMode(undefined, "copilot")).toBe("copilot");
    expect(resolveEffectiveEngagementMode("   ", "autopilot")).toBe("autopilot");
  });

  it("normalizes legacy aliases on both inputs", () => {
    expect(resolveEffectiveEngagementMode("gated_auto", "assisted")).toBe("autopilot");
    expect(resolveEffectiveEngagementMode(null, "gated_auto")).toBe("autopilot");
  });
});

describe("evaluateAutoSend", () => {
  it("auto-sends when every gate passes", () => {
    const d = evaluateAutoSend(HAPPY);
    expect(d.autoSend).toBe(true);
    expect(d.reasons).toEqual([]);
  });

  it("blocks when not in autopilot mode", () => {
    for (const m of ["manual", "copilot"] as const) {
      const d = evaluateAutoSend({ ...HAPPY, engagementMode: m });
      expect(d.autoSend).toBe(false);
      expect(d.reasons).toContain("mode_not_autopilot");
    }
  });

  it("blocks when the draft is not ready (stubbed or failed)", () => {
    expect(evaluateAutoSend({ ...HAPPY, draftStatus: "stubbed" }).reasons).toContain(
      "draft_not_ready",
    );
    expect(evaluateAutoSend({ ...HAPPY, draftStatus: "failed" }).reasons).toContain(
      "draft_not_ready",
    );
  });

  it("blocks when not grounded in the curated Classroom", () => {
    const d = evaluateAutoSend({ ...HAPPY, groundedInClassroom: false });
    expect(d.autoSend).toBe(false);
    expect(d.reasons).toContain("not_grounded_in_classroom");
  });

  it("blocks when confidence is not explicitly high", () => {
    for (const c of ["medium", "low", null] as const) {
      const d = evaluateAutoSend({ ...HAPPY, confidence: c });
      expect(d.autoSend).toBe(false);
      expect(d.reasons).toContain("confidence_not_high");
    }
  });

  it("blocks when the answer did not match the KB", () => {
    const d = evaluateAutoSend({ ...HAPPY, kbMatched: false });
    expect(d.autoSend).toBe(false);
    expect(d.reasons).toContain("no_kb_match");
  });

  it("blocks risky inbound intents even with safe grounding", () => {
    for (const q of ["pricing", "compliance", "technical_setup"] as const) {
      const d = evaluateAutoSend({ ...HAPPY, queryCategory: q });
      expect(d.autoSend).toBe(false);
      expect(d.reasons).toContain("risky_query_category");
    }
  });

  it("blocks when there are no grounding facts at all", () => {
    const d = evaluateAutoSend({ ...HAPPY, groundingCategories: [] });
    expect(d.autoSend).toBe(false);
    expect(d.reasons).toContain("no_grounding_facts");
  });

  it("blocks when any grounding fact is in an unsafe category", () => {
    const d = evaluateAutoSend({
      ...HAPPY,
      groundingCategories: ["general", "pricing"],
    });
    expect(d.autoSend).toBe(false);
    expect(d.reasons).toContain("unsafe_grounding_category");
  });

  it("blocks when there is an unresolved conflict", () => {
    const d = evaluateAutoSend({ ...HAPPY, hasConflict: true });
    expect(d.autoSend).toBe(false);
    expect(d.reasons).toContain("unresolved_conflict");
  });

  it("blocks when outbound compliance fails", () => {
    const d = evaluateAutoSend({ ...HAPPY, complianceOk: false });
    expect(d.autoSend).toBe(false);
    expect(d.reasons).toContain("compliance_block");
  });

  it("allows a null query category as long as grounding is safe", () => {
    const d = evaluateAutoSend({ ...HAPPY, queryCategory: null });
    expect(d.autoSend).toBe(true);
  });

  it("accumulates every failed gate at once", () => {
    const d = evaluateAutoSend({
      engagementMode: "manual",
      draftStatus: "failed",
      confidence: "low",
      kbMatched: false,
      groundedInClassroom: false,
      queryCategory: "pricing",
      groundingCategories: [],
      hasConflict: true,
      complianceOk: false,
    });
    expect(d.autoSend).toBe(false);
    expect(d.reasons).toEqual(
      expect.arrayContaining([
        "mode_not_autopilot",
        "draft_not_ready",
        "not_grounded_in_classroom",
        "confidence_not_high",
        "no_kb_match",
        "risky_query_category",
        "no_grounding_facts",
        "unresolved_conflict",
        "compliance_block",
      ]),
    );
  });
});

// A fully-passing Professor-escalation send input. Each gate test clones this
// and flips ONE field to prove the gate independently blocks the send.
const HAPPY_ESC: EscalationSendInput = {
  engagementMode: "autopilot",
  grokConfigured: true,
  escalationStatus: "answered",
  confidence: "high",
  screenedFactCount: 2,
  hasReply: true,
  escalatedCategories: ["general", "features"],
  queryCategory: "general",
  hasConflict: false,
  complianceOk: true,
  automationHandled: false,
};

describe("evaluateProfessorEscalationSend", () => {
  it("auto-sends when every gate passes", () => {
    const d = evaluateProfessorEscalationSend(HAPPY_ESC);
    expect(d.autoSend).toBe(true);
    expect(d.reasons).toEqual([]);
  });

  it("blocks outside autopilot mode", () => {
    for (const m of ["manual", "copilot"] as const) {
      expect(
        evaluateProfessorEscalationSend({ ...HAPPY_ESC, engagementMode: m }).reasons,
      ).toContain("mode_not_autopilot");
    }
  });

  it("blocks when the automation engine already handled the inbound", () => {
    expect(
      evaluateProfessorEscalationSend({ ...HAPPY_ESC, automationHandled: true }).reasons,
    ).toContain("automation_handled");
  });

  it("blocks when Grok is offline", () => {
    expect(
      evaluateProfessorEscalationSend({ ...HAPPY_ESC, grokConfigured: false }).reasons,
    ).toContain("grok_offline");
  });

  it("blocks when the escalation did not answer", () => {
    expect(
      evaluateProfessorEscalationSend({ ...HAPPY_ESC, escalationStatus: "failed" }).reasons,
    ).toContain("escalation_not_answered");
    expect(
      evaluateProfessorEscalationSend({ ...HAPPY_ESC, escalationStatus: "stubbed" }).reasons,
    ).toContain("escalation_not_answered");
  });

  it("blocks when confidence is not explicitly high", () => {
    expect(
      evaluateProfessorEscalationSend({ ...HAPPY_ESC, confidence: "medium" }).reasons,
    ).toContain("confidence_not_high");
    expect(
      evaluateProfessorEscalationSend({ ...HAPPY_ESC, confidence: null }).reasons,
    ).toContain("confidence_not_high");
  });

  it("blocks when no facts passed screening (nothing to learn)", () => {
    expect(
      evaluateProfessorEscalationSend({ ...HAPPY_ESC, screenedFactCount: 0 }).reasons,
    ).toContain("no_screened_facts");
  });

  it("blocks when there is no reply text", () => {
    expect(
      evaluateProfessorEscalationSend({ ...HAPPY_ESC, hasReply: false }).reasons,
    ).toContain("no_reply_text");
  });

  it("blocks when there are no escalated categories", () => {
    expect(
      evaluateProfessorEscalationSend({ ...HAPPY_ESC, escalatedCategories: [] }).reasons,
    ).toContain("no_escalated_categories");
  });

  it("blocks when any escalated fact is in a high-stakes (unsafe) category", () => {
    expect(
      evaluateProfessorEscalationSend({
        ...HAPPY_ESC,
        escalatedCategories: ["general", "pricing"],
      }).reasons,
    ).toContain("unsafe_escalated_category");
    expect(
      evaluateProfessorEscalationSend({
        ...HAPPY_ESC,
        escalatedCategories: ["compliance"],
      }).reasons,
    ).toContain("unsafe_escalated_category");
  });

  it("blocks a risky inbound intent even when the facts are labeled benign", () => {
    // The Professor labeled its facts general/features, but the customer's
    // QUESTION reads as pricing — the intent gate must still block auto-send.
    expect(
      evaluateProfessorEscalationSend({
        ...HAPPY_ESC,
        queryCategory: "pricing",
      }).reasons,
    ).toContain("risky_query_category");
    expect(
      evaluateProfessorEscalationSend({
        ...HAPPY_ESC,
        queryCategory: "compliance",
      }).reasons,
    ).toContain("risky_query_category");
  });

  it("blocks on an unresolved conflict", () => {
    expect(
      evaluateProfessorEscalationSend({ ...HAPPY_ESC, hasConflict: true }).reasons,
    ).toContain("unresolved_conflict");
  });

  it("blocks when telephony compliance fails", () => {
    expect(
      evaluateProfessorEscalationSend({ ...HAPPY_ESC, complianceOk: false }).reasons,
    ).toContain("compliance_block");
  });
});
