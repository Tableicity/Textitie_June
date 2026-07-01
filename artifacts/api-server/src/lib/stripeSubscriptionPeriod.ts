/**
 * Stripe subscription billing-period resolution.
 *
 * Newer Stripe API versions (2025-03+ "Basil") removed `current_period_start`
 * and `current_period_end` from the Subscription object; the billing period now
 * lives on each subscription *item*. Reading only the (now-null) top-level
 * fields produced `new Date(null|undefined * 1000)` → an Invalid Date, which
 * throws "Invalid time value" when Drizzle maps it to a Postgres timestamp and
 * aborts subscription activation — leaving a paying tenant locked. This module
 * reads the item period first, falls back to the legacy top-level fields, and
 * nulls out anything non-finite so activation can never crash.
 */

export type SubscriptionPeriodSource = {
  status?: string;
  trial_end?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  items?: {
    data?: Array<{
      current_period_start?: number | null;
      current_period_end?: number | null;
    }>;
  };
};

export function unixSecondsToDate(
  seconds: number | null | undefined,
): Date | null {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return null;
  }
  const d = new Date(seconds * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveSubscriptionPeriod(sub: SubscriptionPeriodSource): {
  periodStart: Date | null;
  periodEnd: Date | null;
} {
  const item = sub.items?.data?.[0];
  return {
    periodStart: unixSecondsToDate(
      item?.current_period_start ?? sub.current_period_start,
    ),
    periodEnd: unixSecondsToDate(
      item?.current_period_end ?? sub.current_period_end,
    ),
  };
}
