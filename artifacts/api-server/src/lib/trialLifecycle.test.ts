import { describe, it, expect } from "vitest";
import { selectTrialAction } from "./trialLifecycle";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("selectTrialAction (pure trial-lifecycle decision)", () => {
  it("expires at or past trialEndsAt (msLeft <= 0)", () => {
    expect(selectTrialAction(0)).toBe("expire");
    expect(selectTrialAction(-1)).toBe("expire");
    expect(selectTrialAction(-DAY_MS)).toBe("expire");
  });

  it("fires the day-2 reminder inside the final 2 days", () => {
    expect(selectTrialAction(1)).toBe("remind_day_2");
    expect(selectTrialAction(DAY_MS)).toBe("remind_day_2");
    expect(selectTrialAction(2 * DAY_MS)).toBe("remind_day_2");
  });

  it("fires the day-7 reminder inside the (2, 7]-day window", () => {
    expect(selectTrialAction(2 * DAY_MS + 1)).toBe("remind_day_7");
    expect(selectTrialAction(5 * DAY_MS)).toBe("remind_day_7");
    expect(selectTrialAction(7 * DAY_MS)).toBe("remind_day_7");
  });

  it("does nothing while more than 7 days remain", () => {
    expect(selectTrialAction(7 * DAY_MS + 1)).toBe("none");
    expect(selectTrialAction(8 * DAY_MS)).toBe("none");
    expect(selectTrialAction(30 * DAY_MS)).toBe("none");
  });
});
