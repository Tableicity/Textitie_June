import { describe, it, expect } from "vitest";
import { calculateMessageCredits, MMS_CREDITS } from "./messageCost";

describe("calculateMessageCredits", () => {
  it("charges 1 credit for a short GSM-7 SMS", () => {
    const cost = calculateMessageCredits({ body: "Hello there!" });
    expect(cost.channel).toBe("sms");
    expect(cost.encoding).toBe("GSM-7");
    expect(cost.credits).toBe(1);
    expect(cost.segments).toBe(1);
  });

  it("charges 1 credit at the GSM-7 single-segment boundary (160 chars)", () => {
    const cost = calculateMessageCredits({ body: "a".repeat(160) });
    expect(cost.credits).toBe(1);
  });

  it("charges 2 credits just over the GSM-7 boundary (161 chars → 153/seg)", () => {
    const cost = calculateMessageCredits({ body: "a".repeat(161) });
    expect(cost.encoding).toBe("GSM-7");
    expect(cost.credits).toBe(2);
    expect(cost.segments).toBe(2);
  });

  it("charges 3 credits for a long GSM-7 text (no cap)", () => {
    // 307 chars → ceil(307/153) = 3 segments
    const cost = calculateMessageCredits({ body: "a".repeat(307) });
    expect(cost.credits).toBe(3);
  });

  it("flips to UCS-2 and charges 1 credit for a short emoji SMS", () => {
    const cost = calculateMessageCredits({ body: "Hi 👋" });
    expect(cost.channel).toBe("sms");
    expect(cost.encoding).toBe("UCS-2");
    expect(cost.credits).toBe(1);
  });

  it("charges 2 credits for a UCS-2 SMS over the 70-char boundary", () => {
    // 71 non-GSM-7 (Cyrillic) code units → ceil(71/67) = 2 segments
    const cost = calculateMessageCredits({ body: "ы".repeat(71) });
    expect(cost.encoding).toBe("UCS-2");
    expect(cost.credits).toBe(2);
  });

  it("charges a flat 3 credits when media is attached (MMS)", () => {
    const cost = calculateMessageCredits({ body: "pic", mediaCount: 1 });
    expect(cost.channel).toBe("mms");
    expect(cost.credits).toBe(MMS_CREDITS);
  });

  it("charges a flat 3 credits for MMS even with a long body", () => {
    const cost = calculateMessageCredits({ body: "a".repeat(500), mediaCount: 2 });
    expect(cost.channel).toBe("mms");
    expect(cost.credits).toBe(3);
  });

  it("honors forceMms (deliberate text→MMS wrap) with no media", () => {
    const cost = calculateMessageCredits({ body: "wrap me", forceMms: true });
    expect(cost.channel).toBe("mms");
    expect(cost.credits).toBe(3);
  });

  it("charges 0 credits for an empty SMS body (nothing sent)", () => {
    const cost = calculateMessageCredits({ body: "" });
    expect(cost.channel).toBe("sms");
    expect(cost.credits).toBe(0);
  });

  it("charges 3 credits for an empty body that carries media", () => {
    const cost = calculateMessageCredits({ body: "", mediaCount: 1 });
    expect(cost.credits).toBe(3);
  });
});
