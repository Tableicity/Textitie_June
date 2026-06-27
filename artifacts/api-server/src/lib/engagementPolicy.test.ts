import { describe, it, expect } from "vitest";
import {
  normalizeEngagementMode,
  resolveEffectiveEngagementMode,
} from "./engagementPolicy";

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
