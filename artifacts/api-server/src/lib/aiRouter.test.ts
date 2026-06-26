import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Grok/OpenAI client used inside @workspace/ai-router so triageInbound
// never hits the network. createMock is the single completions.create() seam.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

import {
  triageInbound,
  parseRouterResponse,
  resolveRouteBranch,
  routerConfigured,
  type RouterDecision,
} from "@workspace/ai-router";
import type { Tenant } from "@workspace/db";
import { isRouterBranchAutoSendable } from "./engagementPolicy";

const tenant = {
  id: 1,
  slug: "acme-hvac",
  name: "Acme HVAC Supply",
} as unknown as Tenant;
const brandScope = "We sell HVAC parts and supplies to licensed contractors.";

function grokReply(json: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(json) } }],
    usage: { total_tokens: 12 },
  };
}

function decision(over: Partial<RouterDecision>): RouterDecision {
  return {
    status: "routed",
    intent: "tenant_specific",
    confidence: "high",
    declineMessage: "",
    detail: "",
    latencyMs: 1,
    ...over,
  };
}

const ORIGINAL_KEYS = process.env.GROK_KEYS;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROK_KEYS = "test-key";
});
afterEach(() => {
  if (ORIGINAL_KEYS === undefined) delete process.env.GROK_KEYS;
  else process.env.GROK_KEYS = ORIGINAL_KEYS;
});

describe("parseRouterResponse", () => {
  it("parses a clean out_of_scope payload with a decline", () => {
    const p = parseRouterResponse(
      '{"intent":"out_of_scope","confidence":"high","declineMessage":"Sorry, we only handle HVAC parts."}',
    );
    expect(p.intent).toBe("out_of_scope");
    expect(p.confidence).toBe("high");
    expect(p.declineMessage).toContain("HVAC");
  });
  it("tolerates surrounding prose / markdown fences", () => {
    const p = parseRouterResponse(
      'Sure!\n```json\n{"intent":"general_in_scope","confidence":"high","declineMessage":""}\n```',
    );
    expect(p.intent).toBe("general_in_scope");
    expect(p.confidence).toBe("high");
  });
  it("returns nulls for garbage / invalid intent / empty", () => {
    expect(parseRouterResponse("not json at all").intent).toBeNull();
    expect(
      parseRouterResponse('{"intent":"banana","confidence":"high"}').intent,
    ).toBeNull();
    expect(parseRouterResponse("").intent).toBeNull();
  });
});

describe("resolveRouteBranch (fail-safe policy)", () => {
  it("routes a confident out_of_scope WITH a decline", () => {
    expect(
      resolveRouteBranch(
        decision({ intent: "out_of_scope", declineMessage: "No thanks." }),
      ),
    ).toBe("out_of_scope");
  });
  it("downgrades out_of_scope WITHOUT a decline to tenant_specific", () => {
    expect(
      resolveRouteBranch(decision({ intent: "out_of_scope", declineMessage: "" })),
    ).toBe("tenant_specific");
  });
  it("routes a confident general_in_scope", () => {
    expect(resolveRouteBranch(decision({ intent: "general_in_scope" }))).toBe(
      "general_in_scope",
    );
  });
  it("keeps tenant_specific as tenant_specific", () => {
    expect(resolveRouteBranch(decision({ intent: "tenant_specific" }))).toBe(
      "tenant_specific",
    );
  });
  it("defaults any non-high confidence to tenant_specific", () => {
    expect(
      resolveRouteBranch(
        decision({
          intent: "out_of_scope",
          confidence: "medium",
          declineMessage: "x",
        }),
      ),
    ).toBe("tenant_specific");
    expect(
      resolveRouteBranch(
        decision({ intent: "general_in_scope", confidence: "low" }),
      ),
    ).toBe("tenant_specific");
  });
  it("defaults any non-routed status to tenant_specific", () => {
    for (const status of ["stubbed", "skipped", "failed"] as const) {
      expect(
        resolveRouteBranch(decision({ status, intent: null, confidence: null })),
      ).toBe("tenant_specific");
    }
  });
});

describe("triageInbound (mocked Grok client) — 3 intents + degrade", () => {
  it("classifies out_of_scope and authors a decline", async () => {
    createMock.mockResolvedValue(
      grokReply({
        intent: "out_of_scope",
        confidence: "high",
        declineMessage:
          "Sorry, we only supply HVAC parts — can't help with that.",
      }),
    );
    const d = await triageInbound({
      tenant,
      brandScope,
      inboundBody: "What's on your dinner menu tonight?",
    });
    expect(d.status).toBe("routed");
    expect(d.intent).toBe("out_of_scope");
    expect(d.declineMessage.length).toBeGreaterThan(0);
    expect(resolveRouteBranch(d)).toBe("out_of_scope");
  });

  it("classifies general_in_scope", async () => {
    createMock.mockResolvedValue(
      grokReply({
        intent: "general_in_scope",
        confidence: "high",
        declineMessage: "",
      }),
    );
    const d = await triageInbound({
      tenant,
      brandScope,
      inboundBody: "What's the difference between a heat pump and a furnace?",
    });
    expect(d.intent).toBe("general_in_scope");
    expect(resolveRouteBranch(d)).toBe("general_in_scope");
  });

  it("classifies tenant_specific", async () => {
    createMock.mockResolvedValue(
      grokReply({
        intent: "tenant_specific",
        confidence: "high",
        declineMessage: "",
      }),
    );
    const d = await triageInbound({
      tenant,
      brandScope,
      inboundBody: "How much is the 3-ton condenser coil and is it in stock?",
    });
    expect(d.intent).toBe("tenant_specific");
    expect(resolveRouteBranch(d)).toBe("tenant_specific");
  });

  it("FAILS OPEN (failed → tenant_specific) on unparseable JSON", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "totally not json" } }],
      usage: { total_tokens: 3 },
    });
    const d = await triageInbound({ tenant, brandScope, inboundBody: "hi" });
    expect(d.status).toBe("failed");
    expect(resolveRouteBranch(d)).toBe("tenant_specific");
  });

  it("FAILS OPEN (failed) when the Grok call throws", async () => {
    createMock.mockRejectedValue(new Error("xai 500"));
    const d = await triageInbound({ tenant, brandScope, inboundBody: "hi" });
    expect(d.status).toBe("failed");
    expect(resolveRouteBranch(d)).toBe("tenant_specific");
  });

  it("SKIPS (no Grok call) when brand scope is empty", async () => {
    const d = await triageInbound({ tenant, brandScope: "   ", inboundBody: "hi" });
    expect(d.status).toBe("skipped");
    expect(createMock).not.toHaveBeenCalled();
    expect(resolveRouteBranch(d)).toBe("tenant_specific");
  });

  it("STUBS (no Grok call) when GROK_KEYS is unset", async () => {
    delete process.env.GROK_KEYS;
    expect(routerConfigured()).toBe(false);
    const d = await triageInbound({ tenant, brandScope, inboundBody: "hi" });
    expect(d.status).toBe("stubbed");
    expect(createMock).not.toHaveBeenCalled();
    expect(resolveRouteBranch(d)).toBe("tenant_specific");
  });
});

describe("isRouterBranchAutoSendable (auto-send/learn invariant)", () => {
  it("permits ONLY tenant_specific (the grounded pipeline)", () => {
    expect(isRouterBranchAutoSendable("tenant_specific")).toBe(true);
    expect(isRouterBranchAutoSendable("general_in_scope")).toBe(false);
    expect(isRouterBranchAutoSendable("out_of_scope")).toBe(false);
  });
});
