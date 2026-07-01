import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  useListBillingPlans,
  useGetSubscription,
  useCancelSubscription,
  createCheckoutSession,
  getGetSubscriptionQueryKey,
  getGetBillingUsageQueryKey,
  getGetBillingHistoryQueryKey,
} from "@workspace/api-client-react";
import { Check, Zap, TrendingUp, Crown, Loader2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionHeader } from "./components/SectionHeader";

const TIER_ICONS: Record<string, React.ReactNode> = {
  starter: <Zap className="w-5 h-5" />,
  growth: <TrendingUp className="w-5 h-5" />,
  enterprise: <Crown className="w-5 h-5" />,
};

const TIER_ICON_COLORS: Record<string, string> = {
  starter: "text-blue-600 bg-blue-100",
  growth: "text-purple-600 bg-purple-100",
  enterprise: "text-amber-600 bg-amber-100",
};

export default function Plans() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: "checkout" | "cancel";
    tierCode?: string;
    tierName?: string;
  }>({ open: false, type: "checkout" });

  const { data: plans, isLoading: plansLoading } = useListBillingPlans();
  const { data: subscription } = useGetSubscription();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBillingUsageQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBillingHistoryQueryKey() });
  };

  const checkoutMutation = useMutation({
    mutationFn: async (tierCode: string) => {
      return createCheckoutSession({ tierCode: tierCode as any });
    },
    onSuccess: (result) => {
      window.location.href = result.checkoutUrl;
    },
    onError: (err: any) => {
      toast({ title: "Checkout failed", description: err?.response?.data?.error ?? "Please try again.", variant: "destructive" });
    },
  });

  const cancelMutation = useCancelSubscription({
    mutation: {
      onSuccess: () => { invalidateAll(); setConfirmDialog({ open: false, type: "cancel" }); toast({ title: "Subscription canceled", description: "Your plan has been canceled." }); },
      onError: (err: any) => { toast({ title: "Cancellation failed", description: err?.response?.data?.error ?? "Please try again.", variant: "destructive" }); },
    },
  });

  const isSubscribed = subscription?.status === "active" || subscription?.status === "trialing";
  const currentTier = subscription?.planTierCode;
  // `past_due` still has a live Stripe subscription (payment is retrying), so it
  // is treated as a holding/current plan below — NOT re-purchasable — to avoid
  // spawning a duplicate subscription through a fresh checkout.
  const isPastDue = subscription?.status === "past_due";
  // A lapsed subscription (trial ended or canceled) is NOT "current": the tenant
  // must be able to re-purchase, and the server grants no new trial once one has
  // been used, so lapsed users are charged immediately.
  const isLapsed =
    subscription?.status === "expired" ||
    subscription?.status === "canceled";
  const isMutating = checkoutMutation.isPending || cancelMutation.isPending;

  const handlePlanAction = (tierCode: string, tierName: string) => {
    if (tierCode === "enterprise") {
      window.open("mailto:sales@textitie.com?subject=Enterprise Plan Inquiry", "_blank");
      return;
    }
    setConfirmDialog({ open: true, type: "checkout", tierCode, tierName });
  };

  const handleConfirm = () => {
    if (confirmDialog.type === "checkout" && confirmDialog.tierCode) {
      checkoutMutation.mutate(confirmDialog.tierCode);
    } else if (confirmDialog.type === "cancel") {
      cancelMutation.mutate();
    }
  };

  return (
    <div>
      <SectionHeader
        title="Choose Your Plan"
        subtitle="Pricing plans do not include messaging cost. Pay monthly and pick the plan that fits your organization — you can upgrade, downgrade, or cancel any time."
        action={
          isSubscribed ? (
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
              onClick={() => setConfirmDialog({ open: true, type: "cancel" })}
              data-testid="button-cancel-plan"
            >
              Cancel Plan
            </Button>
          ) : undefined
        }
      />

      {plansLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-96 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans?.map((plan) => {
            const isCurrent = (isSubscribed || isPastDue) && currentTier === plan.tierCode;
            const iconColor = TIER_ICON_COLORS[plan.tierCode] ?? "text-slate-600 bg-slate-100";
            const isEnterprise = plan.tierCode === "enterprise";
            const isUpgrade =
              isSubscribed &&
              currentTier &&
              plans &&
              plans.findIndex((p) => p.tierCode === plan.tierCode) >
                plans.findIndex((p) => p.tierCode === currentTier);

            return (
              <Card
                key={plan.tierCode}
                className={`relative bg-white transition-all ${isCurrent ? "ring-2 ring-blue-500" : "hover:shadow-lg"}`}
                data-testid={`plan-card-${plan.tierCode}`}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-blue-600 text-white">Current Plan</Badge>
                  </div>
                )}
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconColor}`}>
                      {TIER_ICONS[plan.tierCode] ?? <Zap className="w-5 h-5" />}
                    </div>
                    <div>
                      <CardTitle>{plan.name}</CardTitle>
                      <CardDescription>{plan.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-3xl font-bold text-slate-900">
                      {isEnterprise ? "Custom" : plan.monthlyPriceFormatted}
                      {!isEnterprise && <span className="text-sm font-normal text-slate-500">/mo</span>}
                    </p>
                    {plan.trialDays > 0 && !isSubscribed && !isLapsed && !isEnterprise && (
                      <p className="text-xs text-green-600 font-medium mt-1">
                        {plan.trialDays}-day free trial included
                      </p>
                    )}
                  </div>

                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2 text-slate-700">
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      {plan.isUnlimitedCredits
                        ? "Unlimited credits"
                        : `${plan.includedCredits.toLocaleString()} credits/mo`}
                    </li>
                    <li className="flex items-center gap-2 text-slate-700">
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      {plan.maxAgents == null ? "Unlimited agents" : `Up to ${plan.maxAgents} agents`}
                    </li>
                    <li className="flex items-center gap-2 text-slate-700">
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      {plan.maxPhoneNumbers == null
                        ? "Unlimited phone numbers"
                        : `${plan.maxPhoneNumbers} phone number${plan.maxPhoneNumbers !== 1 ? "s" : ""}`}
                    </li>
                    {plan.features.slice(0, 4).map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-slate-700">
                        <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                    {!plan.isUnlimitedCredits && (
                      <li className="flex items-center gap-2 text-slate-400 text-xs">
                        <span className="w-4" />
                        Overage: ${(plan.overageRateCents / 100).toFixed(2)}/credit
                      </li>
                    )}
                  </ul>

                  <Button
                    className="w-full"
                    variant={isCurrent ? "outline" : isEnterprise ? "secondary" : "default"}
                    disabled={isCurrent || (isMutating && confirmDialog.tierCode === plan.tierCode)}
                    onClick={() => handlePlanAction(plan.tierCode, plan.name)}
                    data-testid={`button-plan-${plan.tierCode}`}
                  >
                    {(isMutating && confirmDialog.tierCode === plan.tierCode) ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirecting…</>
                    ) : isCurrent ? (
                      "Current Plan"
                    ) : isEnterprise ? (
                      <><ExternalLink className="w-4 h-4 mr-2" /> Contact Sales</>
                    ) : isSubscribed ? (
                      isUpgrade ? "Upgrade →" : "Downgrade"
                    ) : isLapsed ? (
                      "Subscribe"
                    ) : (
                      "Start Free Trial"
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={confirmDialog.open}
        onOpenChange={(o) => !isMutating && setConfirmDialog({ ...confirmDialog, open: o })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDialog.type === "checkout"
                ? `Subscribe to ${confirmDialog.tierName}`
                : "Cancel Subscription"}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog.type === "checkout"
                ? "You'll be securely redirected to Stripe to complete payment. Your card won't be charged until after any free trial."
                : "Your subscription will be canceled at the end of the current billing period."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}
              disabled={isMutating}
            >
              Back
            </Button>
            <Button
              variant={confirmDialog.type === "cancel" ? "destructive" : "default"}
              onClick={handleConfirm}
              disabled={isMutating}
              data-testid="button-confirm-plan-action"
            >
              {isMutating
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {confirmDialog.type === "checkout" ? "Redirecting…" : "Canceling…"}</>
                : confirmDialog.type === "checkout"
                  ? <><ExternalLink className="w-4 h-4 mr-2" /> Go to Checkout</>
                  : "Confirm Cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
