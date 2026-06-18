import { beforeEach, describe, expect, it, vi } from "vitest";

// reconcileSubscriptionItem re-fetches the LIVE subscription item list on every
// call, so the test controls what `subscriptions.retrieve` returns and asserts
// which mutation (create / update / del) the function performs. Only the Stripe
// client is mocked — the guard logic touches no database.
const del = vi.fn(async (_id: string, _opts?: unknown): Promise<void> => {});
const create = vi.fn(async (_params: unknown): Promise<void> => {});
const update = vi.fn(
  async (_id: string, _params: unknown): Promise<void> => {},
);

let liveItems: Array<{ id: string; quantity?: number; price: { id: string } }> =
  [];

vi.mock("./stripeClient", () => ({
  getUncachableStripeClient: async () => ({
    subscriptions: {
      retrieve: async (_id: string) => ({ items: { data: liveItems } }),
    },
    subscriptionItems: { del, create, update },
  }),
}));

const { reconcileSubscriptionItem } = await import("./carrierBilling");

const BASE = "price_base";
const CARRIER = "price_carrier";
const SURCHARGE = "price_surcharge";

beforeEach(() => {
  del.mockClear();
  create.mockClear();
  update.mockClear();
  liveItems = [];
});

describe("reconcileSubscriptionItem", () => {
  it("creates a new item when the managed price is absent and qty > 0", async () => {
    liveItems = [{ id: "si_base", price: { id: BASE } }];
    await reconcileSubscriptionItem("sub_x", CARRIER, 2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({ price: CARRIER, quantity: 2 });
    expect(del).not.toHaveBeenCalled();
  });

  it("updates quantity when the managed item exists with a different qty", async () => {
    liveItems = [
      { id: "si_base", price: { id: BASE } },
      { id: "si_carrier", quantity: 1, price: { id: CARRIER } },
    ];
    await reconcileSubscriptionItem("sub_x", CARRIER, 3);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toBe("si_carrier");
    expect(update.mock.calls[0]![1]).toMatchObject({ quantity: 3 });
  });

  it("deletes the managed item when qty drops to 0 and a base item remains", async () => {
    liveItems = [
      { id: "si_base", price: { id: BASE } },
      { id: "si_carrier", quantity: 1, price: { id: CARRIER } },
    ];
    await reconcileSubscriptionItem("sub_x", CARRIER, 0);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0]![0]).toBe("si_carrier");
  });

  it("refuses to delete the LAST remaining item (base plan missing anomaly)", async () => {
    // Simulates the post-first-pass state: carrier-fee item already gone, so the
    // surcharge item is the only item left. Deleting it would empty the
    // subscription and 500 the whole sync, so the guard must skip the delete.
    liveItems = [{ id: "si_surcharge", quantity: 1, price: { id: SURCHARGE } }];
    await reconcileSubscriptionItem("sub_x", SURCHARGE, 0);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes duplicate managed items but keeps the final one when no other item exists", async () => {
    // Two managed items of the same price and nothing else: collapse to one
    // rather than emptying the subscription.
    liveItems = [
      { id: "si_carrier_a", quantity: 1, price: { id: CARRIER } },
      { id: "si_carrier_b", quantity: 1, price: { id: CARRIER } },
    ];
    await reconcileSubscriptionItem("sub_x", CARRIER, 0);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0]![0]).toBe("si_carrier_a");
  });
});
