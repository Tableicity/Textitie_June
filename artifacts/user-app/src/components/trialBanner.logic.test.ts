import { describe, it, expect } from "vitest";
import {
  getTrialBannerPhase,
  TRIAL_URGENT_THRESHOLD_MS,
} from "./trialBanner.logic";

const HOUR = 60 * 60 * 1000;

describe("getTrialBannerPhase", () => {
  it("is 'normal' (orange) with comfortable runway while trialing", () => {
    expect(getTrialBannerPhase("trialing", 10 * 24 * HOUR)).toBe("normal");
    // Just outside the urgent window stays calm.
    expect(
      getTrialBannerPhase("trialing", TRIAL_URGENT_THRESHOLD_MS + HOUR),
    ).toBe("normal");
  });

  it("escalates to 'urgent' (red) BEFORE expiry as the deadline nears", () => {
    expect(getTrialBannerPhase("trialing", 2 * HOUR)).toBe("urgent");
    // Exactly at the threshold is already urgent.
    expect(getTrialBannerPhase("trialing", TRIAL_URGENT_THRESHOLD_MS)).toBe(
      "urgent",
    );
  });

  it("is 'expired' (red) when the countdown reaches zero even if status is still trialing", () => {
    expect(getTrialBannerPhase("trialing", 0)).toBe("expired");
    expect(getTrialBannerPhase("trialing", -5 * HOUR)).toBe("expired");
  });

  it("is 'expired' when the server status is expired regardless of remaining", () => {
    expect(getTrialBannerPhase("expired", 5 * HOUR)).toBe("expired");
    expect(getTrialBannerPhase("expired", null)).toBe("expired");
  });

  it("stays 'normal' when the deadline is unknown/malformed (remainingMs null)", () => {
    expect(getTrialBannerPhase("trialing", null)).toBe("normal");
  });
});
