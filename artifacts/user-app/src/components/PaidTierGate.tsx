import { Link } from "wouter";
import { Lock, Sparkles } from "lucide-react";
import {
  useGetSubscription,
  getGetSubscriptionQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Client-side "paid price tier" gate for provisioning features (departments &
 * phone numbers). Free-trial tenants get their auto-assigned demo setup, but
 * self-serve provisioning is reserved for paid plans — the server enforces the
 * same rule (402 subscription_required), so this gate is UX, not the control.
 *
 * Paid = subscription status "active", or the operator billingBypass override
 * (mirrors the server's isTextingUnlocked rule).
 */
export function useIsPaidTier(): {
  /** True only when we KNOW the tenant is on a paid tier. */
  isPaid: boolean;
  /** True once the subscription query has settled (success or error). */
  isLoaded: boolean;
  /** True when the query settled successfully and the tenant is NOT paid. */
  isKnownUnpaid: boolean;
} {
  const { data, isLoading, isError } = useGetSubscription({
    query: { queryKey: getGetSubscriptionQueryKey() },
  });
  const isPaid = data?.status === "active" || data?.billingBypass === true;
  const isLoaded = !isLoading;
  // Never flash a false paywall: only treat as unpaid once data actually
  // arrived. On error we fail open here — the server still enforces.
  const isKnownUnpaid = !isLoading && !isError && !!data && !isPaid;
  return { isPaid, isLoaded, isKnownUnpaid };
}

const UPGRADE_TITLE = "A paid plan is required";
const UPGRADE_BODY =
  "Provisioning departments and phone numbers is available on a paid price tier. Your free trial includes a ready-to-use demo department and phone number — pick a price package to unlock full provisioning.";

/**
 * Alert dialog shown when an unpaid tenant clicks a provisioning call-to-action.
 * Guides them to the Price Packages page.
 */
export function UpgradeRequiredDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="upgrade-required-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-blue-600" />
            {UPGRADE_TITLE}
          </DialogTitle>
          <DialogDescription>{UPGRADE_BODY}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            asChild
            className="bg-blue-600 hover:bg-blue-700"
            data-testid="button-view-price-packages"
          >
            <Link href="~/onboarding/plans" onClick={() => onOpenChange(false)}>
              <Sparkles className="mr-2 h-4 w-4" />
              View Price Packages
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Page-level guard: wraps a provisioning page's content. An unpaid tenant who
 * navigates here directly (deep link, back button) sees the upgrade card
 * instead of the provisioning UI.
 */
export function RequirePaidTier({ children }: { children: React.ReactNode }) {
  const { isLoaded, isKnownUnpaid } = useIsPaidTier();

  if (!isLoaded) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isKnownUnpaid) {
    return (
      <Card data-testid="paid-tier-required-card">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
            <Lock className="h-6 w-6 text-blue-600" />
          </div>
          <div className="max-w-md space-y-1.5">
            <h2 className="text-lg font-semibold text-slate-900">
              {UPGRADE_TITLE}
            </h2>
            <p className="text-sm text-slate-500">{UPGRADE_BODY}</p>
          </div>
          <Button
            asChild
            className="bg-blue-600 hover:bg-blue-700"
            data-testid="button-view-price-packages"
          >
            <Link href="~/onboarding/plans">
              <Sparkles className="mr-2 h-4 w-4" />
              View Price Packages
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
