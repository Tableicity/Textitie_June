import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Grok/OpenAI client used inside @workspace/ai-student so the flash
// draft never hits the network.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

import {
  studentFlashDraft,
  parseFlashReply,
  studentWhisper,
} from "@workspace/ai-student";
import type { Tenant } from "@workspace/db";

const tenant = {
  id: 1,
  slug: "acme-hvac",
  name: "Acme HVAC Supply",
} as unknown as Tenant;

const ORIGINAL_KEYS = process.env.GROK_KEYS;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROK_KEYS = "test-key";
});
afterEach(() => {
  if (ORIGINAL_KEYS === undefined) delete process.env.GROK_KEYS;
  else process.env.GROK_KEYS = ORIGINAL_KEYS;
});

describe("parseFlashReply", () => {
  it("extracts the labelled DRAFT REPLY line", () => {
    expect(parseFlashReply("DRAFT REPLY: A heat pump moves heat.")).toBe(
      "A heat pump moves heat.",
    );
  });
  it("falls back to the whole trimmed body when unlabelled", () => {
    expect(parseFlashReply("  Just the bare reply text.  ")).toBe(
      "Just the bare reply text.",
    );
  });
});

describe("studentFlashDraft", () => {
  it("STUBS (no Grok call) when GROK_KEYS unset; never grounded, never kbMatched", async () => {
    delete process.env.GROK_KEYS;
    const r = await studentFlashDraft({
      tenant,
      fromNumber: "+15551230000",
      inboundBody: "What's the difference between a heat pump and a furnace?",
      brandScope: "HVAC parts supplier",
    });
    expect(r.status).toBe("stubbed");
    expect(r.draftReply).toBe("");
    expect(r.kbMatched).toBe(false);
    expect(r.groundedInClassroom).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("drafts from Grok's general knowledge but is NEVER grounded / NEVER kbMatched", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              "DRAFT REPLY: A heat pump moves heat in or out; a furnace burns fuel to make heat.",
          },
        },
      ],
      usage: { total_tokens: 30 },
    });
    const r = await studentFlashDraft({
      tenant,
      fromNumber: "+15551230000",
      inboundBody: "heat pump vs furnace?",
      brandScope: "HVAC parts supplier",
    });
    expect(r.status).toBe("drafted");
    expect(r.draftReply).toContain("heat pump");
    // The flash draft is parametric, not Classroom-grounded — these MUST stay
    // false so the auto-send gate can never treat it as grounded.
    expect(r.kbMatched).toBe(false);
    expect(r.groundedInClassroom).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("does not touch the studentWhisper contract (separate export/path)", () => {
    expect(typeof studentWhisper).toBe("function");
    expect(typeof studentFlashDraft).toBe("function");
    expect(studentWhisper).not.toBe(studentFlashDraft);
  });
});
