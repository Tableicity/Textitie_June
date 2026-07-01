import { describe, it, expect } from "vitest";
import {
  isTextingUnlocked,
  normalizeDemoPhone,
  isDemoTextingBlocked,
  isTrialDailyBudgetExceeded,
  PAYWALL_NEW_CONTACT_MESSAGE,
  DAILY_TRIAL_LIMIT_MESSAGE,
  TRIAL_EXPIRED_MESSAGE,
  TRIAL_DAILY_SEGMENT_CAP,
} from "./demoTextingGate";
import {
  SEND_NOTICES,
  SEND_NOTICE_REASONS,
  getSendNotice,
  isSendNoticeReason,
} from "@workspace/send-notices";

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

describe("trial daily outbound budget (pure policy)", () => {
  it("exposes the exact required limit copy and cap", () => {
    expect(DAILY_TRIAL_LIMIT_MESSAGE).toBe(
      "Daily trial message limit reached. Upgrade to a paid plan or wait 24 hours to resume testing.",
    );
    expect(TRIAL_DAILY_SEGMENT_CAP).toBe(15);
  });

  it("never caps an active or bypassed tenant", () => {
    expect(
      isTrialDailyBudgetExceeded({
        subscriptionStatus: "active",
        priorSegments24h: 1000,
        pendingSegments: 10,
      }),
    ).toBe(false);
    expect(
      isTrialDailyBudgetExceeded({
        subscriptionStatus: "trialing",
        billingBypass: true,
        priorSegments24h: 1000,
        pendingSegments: 10,
      }),
    ).toBe(false);
  });

  it("only caps 'trialing' tenants — other unpaid statuses are not budget-capped", () => {
    for (const s of ["none", "past_due", "canceled", "expired"]) {
      expect(
        isTrialDailyBudgetExceeded({
          subscriptionStatus: s,
          priorSegments24h: 100,
          pendingSegments: 10,
        }),
      ).toBe(false);
    }
  });

  it("allows a trialing tenant up to and including the cap, blocks over it", () => {
    // 14 used + 1 pending = 15 → exactly at cap → allowed.
    expect(
      isTrialDailyBudgetExceeded({
        subscriptionStatus: "trialing",
        priorSegments24h: 14,
        pendingSegments: 1,
      }),
    ).toBe(false);
    // 15 used + 1 pending = 16 → over cap → blocked.
    expect(
      isTrialDailyBudgetExceeded({
        subscriptionStatus: "trialing",
        priorSegments24h: 15,
        pendingSegments: 1,
      }),
    ).toBe(true);
    // A single multi-segment message that alone exceeds the cap is blocked.
    expect(
      isTrialDailyBudgetExceeded({
        subscriptionStatus: "trialing",
        priorSegments24h: 0,
        pendingSegments: 16,
      }),
    ).toBe(true);
  });
});

describe("shared send-notice catalog (@workspace/send-notices)", () => {
  it("locks the exact customer-facing copy for every send-block reason", () => {
    // These strings are the single source of truth shared with the user-app.
    // If you change them here, the banner + toast + server body all move together.
    expect(SEND_NOTICES.paywall_new_contact.message).toBe(
      "You will need a Paid Subscription to text New Contacts",
    );
    expect(SEND_NOTICES.daily_trial_limit.message).toBe(
      "Daily trial message limit reached. Upgrade to a paid plan or wait 24 hours to resume testing.",
    );
    expect(SEND_NOTICES.trial_expired.message).toBe(
      "Your free trial has ended. Upgrade to a paid plan to resume texting.",
    );
    expect(SEND_NOTICES.credit_frozen.message).toBe(
      "This message can't be sent — your messaging credits are exhausted. Add credits or enable Backup auto-replenish to resume sending.",
    );
  });

  it("is complete and self-consistent (key === reason, valid httpStatus)", () => {
    expect(SEND_NOTICE_REASONS.sort()).toEqual(
      [
        "credit_frozen",
        "daily_trial_limit",
        "paywall_new_contact",
        "trial_expired",
      ].sort(),
    );
    for (const reason of SEND_NOTICE_REASONS) {
      const notice = SEND_NOTICES[reason];
      expect(notice.reason).toBe(reason);
      expect(notice.message.trim().length).toBeGreaterThan(0);
      expect(notice.title.trim().length).toBeGreaterThan(0);
      expect(notice.httpStatus).toBe(402);
    }
  });

  it("server constants re-source the catalog verbatim (no drift possible)", () => {
    expect(PAYWALL_NEW_CONTACT_MESSAGE).toBe(
      SEND_NOTICES.paywall_new_contact.message,
    );
    expect(DAILY_TRIAL_LIMIT_MESSAGE).toBe(
      SEND_NOTICES.daily_trial_limit.message,
    );
    expect(TRIAL_EXPIRED_MESSAGE).toBe(SEND_NOTICES.trial_expired.message);
  });

  it("getSendNotice / isSendNoticeReason tolerate unknown wire values", () => {
    expect(getSendNotice("paywall_new_contact")).toBe(
      SEND_NOTICES.paywall_new_contact,
    );
    expect(getSendNotice("compliance")).toBeUndefined();
    expect(getSendNotice(undefined)).toBeUndefined();
    expect(getSendNotice(42)).toBeUndefined();
    expect(isSendNoticeReason("credit_frozen")).toBe(true);
    expect(isSendNoticeReason("nope")).toBe(false);
  });
});
