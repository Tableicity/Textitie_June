import { describe, it, expect } from "vitest";
import {
  shouldQueryStripeForReconcile,
  pickReconcileTarget,
  BILLING_RECONCILE_THROTTLE_MS,
} from "./billingReconcile";

describe("shouldQueryStripeForReconcile", () => {
  const base = {
    subscriptionStatus: "expired" as string | null,
    billingBypass: false as boolean | null,
    stripeCustomerId: "cus_live123" as string | null,
    lastBillingSyncAt: null as Date | null,
    now: 1_000_000_000,
  };

  it("queries Stripe for a locked tenant with a real customer", () => {
    expect(shouldQueryStripeForReconcile(base)).toEqual({ query: true });
  });

  it("skips when the operator bypass is on", () => {
    expect(shouldQueryStripeForReconcile({ ...base, billingBypass: true })).toEqual({
      query: false,
      reason: "billing_bypass",
    });
  });

  it("skips when the tenant is already active", () => {
    expect(
      shouldQueryStripeForReconcile({ ...base, subscriptionStatus: "active" }),
    ).toEqual({ query: false, reason: "already_active" });
  });

  it("skips when there is no real Stripe customer", () => {
    for (const cid of [null, undefined, "", "cus_stub_x", "garbage"]) {
      expect(
        shouldQueryStripeForReconcile({ ...base, stripeCustomerId: cid as string | null }),
      ).toEqual({ query: false, reason: "no_stripe_customer" });
    }
  });

  it("throttles a re-check inside the window", () => {
    const recent = new Date(base.now - 1_000);
    expect(
      shouldQueryStripeForReconcile({ ...base, lastBillingSyncAt: recent }),
    ).toEqual({ query: false, reason: "throttled" });
  });

  it("allows a re-check once the window elapses", () => {
    const old = new Date(base.now - BILLING_RECONCILE_THROTTLE_MS - 1);
    expect(
      shouldQueryStripeForReconcile({ ...base, lastBillingSyncAt: old }),
    ).toEqual({ query: true });
  });

  it("force overrides only the throttle, not the other guards", () => {
    const recent = new Date(base.now - 1_000);
    expect(
      shouldQueryStripeForReconcile({ ...base, lastBillingSyncAt: recent, force: true }),
    ).toEqual({ query: true });
    // force does NOT resurrect a bypassed/active/no-customer tenant
    expect(
      shouldQueryStripeForReconcile({ ...base, billingBypass: true, force: true }),
    ).toEqual({ query: false, reason: "billing_bypass" });
  });
});

describe("pickReconcileTarget", () => {
  it("prefers an active subscription over a trialing one and reads tierCode from metadata", () => {
    const target = pickReconcileTarget(
      [
        { id: "sub_trial", status: "trialing", metadata: { tierCode: "starter" } },
        { id: "sub_active", status: "active", metadata: { tierCode: "growth" } },
      ],
      null,
    );
    expect(target).toEqual({
      action: "activate",
      subscriptionId: "sub_active",
      tierCode: "growth",
      status: "active",
    });
  });

  it("falls back to a trialing subscription when none are active", () => {
    const target = pickReconcileTarget(
      [{ id: "sub_trial", status: "trialing", metadata: { tierCode: "starter" } }],
      null,
    );
    expect(target).toEqual({
      action: "activate",
      subscriptionId: "sub_trial",
      tierCode: "starter",
      status: "trialing",
    });
  });

  it("falls back to the tenant plan then 'starter' when metadata lacks a tierCode", () => {
    expect(
      pickReconcileTarget([{ id: "s1", status: "active", metadata: {} }], "growth"),
    ).toMatchObject({ tierCode: "growth" });
    expect(
      pickReconcileTarget([{ id: "s1", status: "active", metadata: null }], null),
    ).toMatchObject({ tierCode: "starter" });
  });

  it("resolves tierCode from the price-id map when metadata is missing", () => {
    const map = new Map([["price_growth", "growth"]]);
    expect(
      pickReconcileTarget(
        [{ id: "s1", status: "active", metadata: {}, priceId: "price_growth" }],
        null,
        map,
      ),
    ).toMatchObject({ tierCode: "growth" });
  });

  it("prefers metadata tierCode over the price-id map and the price map over the tenant plan", () => {
    const map = new Map([["price_growth", "growth"]]);
    expect(
      pickReconcileTarget(
        [{ id: "s1", status: "active", metadata: { tierCode: "scale" }, priceId: "price_growth" }],
        "starter",
        map,
      ),
    ).toMatchObject({ tierCode: "scale" });
    expect(
      pickReconcileTarget(
        [{ id: "s1", status: "active", metadata: {}, priceId: "price_growth" }],
        "starter",
        map,
      ),
    ).toMatchObject({ tierCode: "growth" });
  });

  it("skips when no subscription is active or trialing", () => {
    expect(
      pickReconcileTarget(
        [
          { id: "sub_pd", status: "past_due", metadata: {} },
          { id: "sub_c", status: "canceled", metadata: {} },
        ],
        "starter",
      ),
    ).toEqual({ action: "skip", reason: "no_active_subscription" });
  });

  it("skips on an empty subscription list", () => {
    expect(pickReconcileTarget([], "starter")).toEqual({
      action: "skip",
      reason: "no_active_subscription",
    });
  });
});
