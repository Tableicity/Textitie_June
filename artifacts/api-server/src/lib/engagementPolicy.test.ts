import { describe, it, expect } from "vitest";
import {
  normalizeEngagementMode,
  evaluateAutoSend,
  type AutoSendInput,
} from "./engagementPolicy";

// A fully-passing input. Every gate test below clones this and flips ONE field
// so we prove each gate independently blocks the send.
const HAPPY: AutoSendInput = {
  engagementMode: "gated_auto",
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
  it("passes through known modes", () => {
    expect(normalizeEngagementMode("assisted")).toBe("assisted");
    expect(normalizeEngagementMode("gated_auto")).toBe("gated_auto");
  });

  it("is case/whitespace tolerant", () => {
    expect(normalizeEngagementMode("  GATED_AUTO ")).toBe("gated_auto");
    expect(normalizeEngagementMode("Assisted")).toBe("assisted");
  });

  it("defaults unknown/empty/non-string to assisted (fail-safe)", () => {
    expect(normalizeEngagementMode("auto")).toBe("assisted");
    expect(normalizeEngagementMode("")).toBe("assisted");
    expect(normalizeEngagementMode(null)).toBe("assisted");
    expect(normalizeEngagementMode(undefined)).toBe("assisted");
    expect(normalizeEngagementMode(42)).toBe("assisted");
  });
});

describe("evaluateAutoSend", () => {
  it("auto-sends when every gate passes", () => {
    const d = evaluateAutoSend(HAPPY);
    expect(d.autoSend).toBe(true);
    expect(d.reasons).toEqual([]);
  });

  it("blocks when not in gated_auto mode", () => {
    const d = evaluateAutoSend({ ...HAPPY, engagementMode: "assisted" });
    expect(d.autoSend).toBe(false);
    expect(d.reasons).toContain("mode_not_gated_auto");
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
      engagementMode: "assisted",
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
        "mode_not_gated_auto",
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
