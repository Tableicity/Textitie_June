import { describe, expect, it, vi } from "vitest";

// classifyQueryCategory is pure, but knowledge.ts pulls in grokClient at import
// time — stub it so the module loads without GROK_KEYS in the test env.
vi.mock("./grokClient", () => ({
  grokClient: () => null,
  PROFESSOR_MODEL: "test-model",
}));

const { classifyQueryCategory } = await import("./knowledge");

describe("classifyQueryCategory", () => {
  it("detects pricing intent", () => {
    expect(classifyQueryCategory("How much does the Pro plan cost?")).toBe(
      "pricing",
    );
    expect(classifyQueryCategory("Can I get a refund on my subscription?")).toBe(
      "pricing",
    );
    expect(classifyQueryCategory("What's the price? $50 maybe?")).toBe("pricing");
  });

  it("detects compliance intent", () => {
    expect(classifyQueryCategory("Is my data GDPR compliant?")).toBe(
      "compliance",
    );
    expect(classifyQueryCategory("How do I unsubscribe / opt-out?")).toBe(
      "compliance",
    );
    expect(classifyQueryCategory("Do you support HIPAA?")).toBe("compliance");
  });

  it("detects technical_setup intent", () => {
    expect(classifyQueryCategory("How do I set up the API webhook?")).toBe(
      "technical_setup",
    );
    expect(classifyQueryCategory("My login is broken, password reset?")).toBe(
      "technical_setup",
    );
  });

  it("detects feature intent", () => {
    expect(classifyQueryCategory("What features do you have?")).toBe("features");
    expect(classifyQueryCategory("Are you able to send group messages?")).toBe(
      "features",
    );
  });

  it("returns null when no category dominates", () => {
    expect(classifyQueryCategory("")).toBeNull();
    expect(classifyQueryCategory("   ")).toBeNull();
    expect(classifyQueryCategory("Hi there, just saying hello")).toBeNull();
  });

  it("breaks ties toward the higher-stakes category", () => {
    // "can i" (features) vs "refund" (pricing) — both score 1; pricing wins.
    expect(classifyQueryCategory("Can I get a refund?")).toBe("pricing");
  });
});
