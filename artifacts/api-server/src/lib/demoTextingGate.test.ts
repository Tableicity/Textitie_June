import { describe, it, expect } from "vitest";
import {
  isTextingUnlocked,
  normalizeDemoPhone,
  isDemoTextingBlocked,
  PAYWALL_NEW_CONTACT_MESSAGE,
} from "./demoTextingGate";

describe("demoTextingGate pure policy", () => {
  it("treats only 'active' as unlocked (trial/none/past_due/canceled stay gated)", () => {
    expect(isTextingUnlocked("active")).toBe(true);
    for (const s of [
      "none",
      "trialing",
      "past_due",
      "canceled",
      "incomplete",
      null,
      undefined,
      "",
    ]) {
      expect(isTextingUnlocked(s as string | null | undefined)).toBe(false);
    }
  });

  it("treats billingBypass=true as unlocked even when unpaid", () => {
    expect(isTextingUnlocked("none", true)).toBe(true);
    expect(isTextingUnlocked("trialing", true)).toBe(true);
    expect(isTextingUnlocked(null, true)).toBe(true);
    // bypass off/unset keeps the active-only rule
    expect(isTextingUnlocked("none", false)).toBe(false);
    expect(isTextingUnlocked("none", undefined)).toBe(false);
  });

  it("never blocks a bypassed tenant, regardless of destination", () => {
    expect(
      isDemoTextingBlocked({
        subscriptionStatus: "none",
        allowedPhone: "+15550000000",
        contactPhone: "+15559999999",
        billingBypass: true,
      }),
    ).toBe(false);
  });

  it("normalizes equivalent US numbers to the same comparable form", () => {
    expect(normalizeDemoPhone("+15551234567")).toBe(
      normalizeDemoPhone("5551234567"),
    );
    expect(normalizeDemoPhone("(555) 123-4567")).toBe(
      normalizeDemoPhone("+1 555 123 4567"),
    );
    expect(normalizeDemoPhone("")).toBe("");
    expect(normalizeDemoPhone(null)).toBe("");
    expect(normalizeDemoPhone(undefined)).toBe("");
  });

  it("never blocks an active tenant, regardless of destination", () => {
    expect(
      isDemoTextingBlocked({
        subscriptionStatus: "active",
        allowedPhone: "+15550000000",
        contactPhone: "+15559999999",
      }),
    ).toBe(false);
  });

  it("lets an unpaid tenant text ONLY its signup phone", () => {
    const allowedPhone = "+15551112222";
    expect(
      isDemoTextingBlocked({
        subscriptionStatus: "trialing",
        allowedPhone,
        contactPhone: "+15551112222",
      }),
    ).toBe(false);
    // Same number, different formatting, still allowed.
    expect(
      isDemoTextingBlocked({
        subscriptionStatus: "none",
        allowedPhone,
        contactPhone: "(555) 111-2222",
      }),
    ).toBe(false);
    // A different (new) contact is blocked.
    expect(
      isDemoTextingBlocked({
        subscriptionStatus: "none",
        allowedPhone,
        contactPhone: "+15553334444",
      }),
    ).toBe(true);
  });

  it("fails closed when unpaid and no signup phone is known", () => {
    expect(
      isDemoTextingBlocked({
        subscriptionStatus: "none",
        allowedPhone: null,
        contactPhone: "+15551112222",
      }),
    ).toBe(true);
  });

  it("exposes the exact required paywall copy", () => {
    expect(PAYWALL_NEW_CONTACT_MESSAGE).toBe(
      "You will need a Paid Subscription to text New Contacts",
    );
  });
});
