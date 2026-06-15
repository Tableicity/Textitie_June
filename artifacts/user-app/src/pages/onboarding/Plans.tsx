import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListBillingPlans,
  useGetSubscription,
  useSubscribe,
  useChangePlan,
  useCancelSubscription,
  getGetSubscriptionQueryKey,
  getGetBillingUsageQueryKey,
  getGetBillingHistoryQueryKey,
} from "@workspace/api-client-react";
import { Check, Zap, TrendingUp, Crown } from "lucide-react";
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
    type: "subscribe" | "change" | "cancel";
    tierCode?: string;
    tierName?: string;
  }>({ open: false, type: "subscribe" });

  const { data: plans, isLoading: plansLoading } = useListBillingPlans();
  const { data: subscription } = useGetSubscription();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBillingUsageQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBillingHistoryQueryKey() });
  };

  const subscribeMutation = useSubscribe({
    mutation: {
      onSuccess: () => { invalidateAll(); setConfirmDialog({ open: false, type: "subscribe" }); toast({ title: "Subscription started", description: "Your free trial has begun." }); },
      onError: (err: any) => { toast({ title: "Subscription failed", description: err?.response?.data?.error ?? "Please try again.", variant: "destructive" }); },
    },
  });
  const changePlanMutation = useChangePlan({
    mutation: {
      onSuccess: () => { invalidateAll(); setConfirmDialog({ open: false, type: "change" }); toast({ title: "Plan changed", description: "Your subscription has been updated." }); },
      onError: (err: any) => { toast({ title: "Plan change failed", description: err?.response?.data?.error ?? "Please try again.", variant: "destructive" }); },
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
  const isMutating = subscribeMutation.isPending || changePlanMutation.isPending || cancelMutation.isPending;

  const handlePlanAction = (tierCode: string, tierName: string) => {
    if (!isSubscribed) {
      setConfirmDialog({ open: true, type: "subscribe", tierCode, tierName });
    } else if (currentTier !== tierCode) {
      setConfirmDialog({ open: true, type: "change", tierCode, tierName });
    }
  };

  const handleConfirm = () => {
    if (confirmDialog.type === "subscribe" && confirmDialog.tierCode) {
      subscribeMutation.mutate({ data: { tierCode: confirmDialog.tierCode as any } });
    } else if (confirmDialog.type === "change" && confirmDialog.tierCode) {
      changePlanMutation.mutate({ data: { tierCode: confirmDialog.tierCode as any } });
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
            const isCurrent = currentTier === plan.tierCode;
            const iconColor = TIER_ICON_COLORS[plan.tierCode] ?? "text-slate-600 bg-slate-100";
            const upgrade =
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
                      {plan.monthlyPriceFormatted}
                      <span className="text-sm font-normal text-slate-500">/mo</span>
                    </p>
                    {plan.trialDays > 0 && !isSubscribed && (
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
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isCurrent || isMutating}
                    onClick={() => handlePlanAction(plan.tierCode, plan.name)}
                    data-testid={`button-plan-${plan.tierCode}`}
                  >
                    {isCurrent
                      ? "Current Plan"
                      : isSubscribed
                        ? upgrade
                          ? "Upgrade"
                          : "Downgrade"
                        : "Start Free Trial"}
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
              {confirmDialog.type === "subscribe"
                ? `Start ${confirmDialog.tierName} Plan`
                : confirmDialog.type === "change"
                  ? `Switch to ${confirmDialog.tierName}`
                  : "Cancel Subscription"}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog.type === "subscribe"
                ? "You'll start with a free trial. No charges until the trial ends."
                : confirmDialog.type === "change"
                  ? "Your plan will change immediately. Credits will be adjusted for the new plan."
                  : "Your subscription will be canceled immediately. You'll lose access to plan features."}
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
              {isMutating ? "Working…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
