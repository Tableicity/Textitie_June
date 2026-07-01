import { describe, it, expect } from "vitest";
import {
  resolveSubscriptionPeriod,
  unixSecondsToDate,
} from "./stripeSubscriptionPeriod";

describe("unixSecondsToDate", () => {
  it("converts a valid unix timestamp to a Date", () => {
    expect(unixSecondsToDate(1782882297)?.toISOString()).toBe(
      new Date(1782882297000).toISOString(),
    );
  });

  it("returns null for null/undefined/NaN/zero", () => {
    expect(unixSecondsToDate(null)).toBeNull();
    expect(unixSecondsToDate(undefined)).toBeNull();
    expect(unixSecondsToDate(Number.NaN)).toBeNull();
    expect(unixSecondsToDate(0)).toBeNull();
  });
});

describe("resolveSubscriptionPeriod", () => {
  it("reads the per-item period when top-level fields are null (current Stripe API)", () => {
    const { periodStart, periodEnd } = resolveSubscriptionPeriod({
      current_period_start: null,
      current_period_end: null,
      items: {
        data: [
          { current_period_start: 1782882297, current_period_end: 1785560697 },
        ],
      },
    });
    expect(periodStart?.toISOString()).toBe(
      new Date(1782882297000).toISOString(),
    );
    expect(periodEnd?.toISOString()).toBe(
      new Date(1785560697000).toISOString(),
    );
  });

  it("falls back to legacy top-level fields when items are absent", () => {
    const { periodStart, periodEnd } = resolveSubscriptionPeriod({
      current_period_start: 1782882297,
      current_period_end: 1785560697,
    });
    expect(periodStart?.toISOString()).toBe(
      new Date(1782882297000).toISOString(),
    );
    expect(periodEnd?.toISOString()).toBe(
      new Date(1785560697000).toISOString(),
    );
  });

  it("returns nulls (never Invalid Date) when the period is missing everywhere", () => {
    const { periodStart, periodEnd } = resolveSubscriptionPeriod({
      status: "active",
    });
    expect(periodStart).toBeNull();
    expect(periodEnd).toBeNull();
  });
});
