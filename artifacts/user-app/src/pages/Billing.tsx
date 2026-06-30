import { useState, useEffect } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  useListBillingPlans,
  useGetSubscription,
  useGetBillingUsage,
  useGetBillingHistory,
  useCancelSubscription,
  createCheckoutSession,
  getGetSubscriptionQueryKey,
  getGetBillingUsageQueryKey,
  getGetBillingHistoryQueryKey,
} from "@workspace/api-client-react";
import {
  CreditCard,
  Check,
  AlertCircle,
  TrendingUp,
  Zap,
  Crown,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  XCircle,
  Loader2,
  BarChart3,
  Infinity,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUS_BADGES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  none: { label: "No Plan", variant: "outline" },
  trialing: { label: "Free Trial", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  past_due: { label: "Past Due", variant: "destructive" },
  canceled: { label: "Canceled", variant: "destructive" },
  expired: { label: "Trial Ended", variant: "destructive" },
};

const TIER_ICONS: Record<string, React.ReactNode> = {
  starter: <Zap className="w-5 h-5" />,
  growth: <TrendingUp className="w-5 h-5" />,
  enterprise: <Crown className="w-5 h-5" />,
};

const TIER_COLORS: Record<string, string> = {
  starter: "border-blue-200 bg-blue-50",
  growth: "border-purple-200 bg-purple-50",
  enterprise: "border-amber-200 bg-amber-50",
};

const TIER_ICON_COLORS: Record<string, string> = {
  starter: "text-blue-600 bg-blue-100",
  growth: "text-purple-600 bg-purple-100",
  enterprise: "text-amber-600 bg-amber-100",
};

const EVENT_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  subscribed: { label: "Subscribed", icon: <Check className="w-4 h-4" />, color: "text-green-600" },
  trial_started: { label: "Trial Started", icon: <Clock className="w-4 h-4" />, color: "text-blue-600" },
  trial_ended: { label: "Trial Ended", icon: <Clock className="w-4 h-4" />, color: "text-slate-600" },
  upgraded: { label: "Upgraded", icon: <ArrowUpRight className="w-4 h-4" />, color: "text-green-600" },
  downgraded: { label: "Downgraded", icon: <ArrowDownRight className="w-4 h-4" />, color: "text-orange-600" },
  canceled: { label: "Canceled", icon: <XCircle className="w-4 h-4" />, color: "text-red-600" },
  payment_succeeded: { label: "Payment Received", icon: <Check className="w-4 h-4" />, color: "text-green-600" },
  payment_failed: { label: "Payment Failed", icon: <AlertCircle className="w-4 h-4" />, color: "text-red-600" },
};

export default function Billing() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: "checkout" | "cancel";
    tierCode?: string;
    tierName?: string;
  }>({ open: false, type: "checkout" });

  const { data: plans, isLoading: plansLoading } = useListBillingPlans();
  const { data: subscription, isLoading: subLoading } = useGetSubscription();
  const { data: usage, isLoading: usageLoading } = useGetBillingUsage();
  const { data: history, isLoading: historyLoading } = useGetBillingHistory();

  // Show success / canceled toast when Stripe redirects back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (checkout === "success") {
      toast({ title: "Payment successful!", description: "Your subscription is now active. It may take a moment to reflect." });
      queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetBillingUsageQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetBillingHistoryQueryKey() });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (checkout === "canceled") {
      toast({ title: "Checkout canceled", description: "No charge was made.", variant: "default" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBillingUsageQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBillingHistoryQueryKey() });
  };

  const checkoutMutation = useMutation({
    mutationFn: async (tierCode: string) => {
      const result = await createCheckoutSession({ tierCode: tierCode as any });
      return result;
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

  const isMutating = checkoutMutation.isPending || cancelMutation.isPending;

  const trialDaysLeft = subscription?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const usagePercent = usage && usage.creditsIncluded > 0
    ? Math.min(100, Math.round((usage.creditsUsed / usage.creditsIncluded) * 100))
    : 0;

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-8 py-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Billing</h1>
            <p className="text-slate-500 text-sm mt-1">Manage your subscription, usage, and billing history.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-6xl mx-auto space-y-8">

          {/* Current Subscription Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Current Plan</CardTitle>
                  <CardDescription>Your active subscription details</CardDescription>
                </div>
                {subLoading ? (
                  <Skeleton className="h-6 w-20" />
                ) : (
                  <Badge variant={STATUS_BADGES[subscription?.status ?? "none"]?.variant ?? "outline"}>
                    {STATUS_BADGES[subscription?.status ?? "none"]?.label ?? "Unknown"}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {subLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-4 w-64" />
                </div>
              ) : !isSubscribed ? (
                <div className="text-center py-6">
                  <CreditCard className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-600 font-medium">No active subscription</p>
                  <p className="text-slate-400 text-sm mt-1">Choose a plan below to get started.</p>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${TIER_ICON_COLORS[currentTier ?? ""]}`}>
                        {TIER_ICONS[currentTier ?? ""] ?? <Zap className="w-5 h-5" />}
                      </div>
                      <div>
                        <p className="text-xl font-bold text-slate-900">{subscription?.planName}</p>
                        <p className="text-slate-500 text-sm">
                          {subscription?.monthlyPriceCents
                            ? `$${(subscription.monthlyPriceCents / 100).toFixed(2)}/month`
                            : "Free"}
                        </p>
                      </div>
                    </div>
                    {subscription?.status === "trialing" && trialDaysLeft > 0 && (
                      <Alert className="mt-3 border-blue-200 bg-blue-50">
                        <Clock className="h-4 w-4 text-blue-600" />
                        <AlertDescription className="text-blue-700">
                          <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}</strong> remaining in your free trial.
                          Your card won't be charged until the trial ends.
                        </AlertDescription>
                      </Alert>
                    )}
                    {subscription?.currentPeriodEnd && (
                      <p className="text-xs text-slate-400 mt-1">
                        Current period ends {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                    onClick={() => setConfirmDialog({ open: true, type: "cancel" })}
                  >
                    Cancel Plan
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Usage Card */}
          {isSubscribed && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-slate-500" />
                  Usage This Period
                </CardTitle>
                <CardDescription>
                  {usage?.periodStart && usage?.periodEnd
                    ? `${new Date(usage.periodStart).toLocaleDateString()} — ${new Date(usage.periodEnd).toLocaleDateString()}`
                    : "Current billing period"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {usageLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-8 w-48" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-3xl font-bold text-slate-900">
                          {usage?.creditsUsed?.toLocaleString() ?? 0}
                        </p>
                        <p className="text-sm text-slate-500">
                          credits used of{" "}
                          {usage?.isUnlimited ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                              <Infinity className="w-4 h-4" /> unlimited
                            </span>
                          ) : (
                            <span className="font-medium">{usage?.creditsIncluded?.toLocaleString() ?? 0}</span>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-slate-500">Messages sent</p>
                        <p className="text-lg font-semibold text-slate-900">{usage?.messagesSent?.toLocaleString() ?? 0}</p>
                      </div>
                    </div>

                    {!usage?.isUnlimited && (
                      <div className="space-y-1">
                        <Progress value={usagePercent} className="h-3" />
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>{usagePercent}% used</span>
                          <span>{Math.max(0, (usage?.creditsIncluded ?? 0) - (usage?.creditsUsed ?? 0)).toLocaleString()} remaining</span>
                        </div>
                      </div>
                    )}

                    {(usage?.overageCredits ?? 0) > 0 && (
                      <Alert className="border-orange-200 bg-orange-50">
                        <AlertCircle className="h-4 w-4 text-orange-600" />
                        <AlertDescription className="text-orange-700">
                          <strong>{usage?.overageCredits?.toLocaleString()}</strong> overage credits at ${((usage?.overageRateCents ?? 3) / 100).toFixed(2)}/credit = <strong>${((usage?.overageAmountCents ?? 0) / 100).toFixed(2)}</strong> overage charge.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Plan Cards */}
          <div>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {isSubscribed ? "Change Plan" : "Choose a Plan"}
            </h2>
            {plansLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-72 w-full rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {plans?.map((plan) => {
                  const isCurrent = currentTier === plan.tierCode;
                  const tierColor = TIER_COLORS[plan.tierCode] ?? "border-slate-200";
                  const iconColor = TIER_ICON_COLORS[plan.tierCode] ?? "text-slate-600 bg-slate-100";
                  const isEnterprise = plan.tierCode === "enterprise";
                  const isUpgrade = isSubscribed && currentTier && plans &&
                    plans.findIndex((p) => p.tierCode === plan.tierCode) > plans.findIndex((p) => p.tierCode === currentTier);

                  return (
                    <Card
                      key={plan.tierCode}
                      className={`relative transition-all ${isCurrent ? `ring-2 ring-blue-500 ${tierColor}` : `hover:shadow-lg ${tierColor}`}`}
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
                          {plan.trialDays > 0 && !isSubscribed && !isEnterprise && (
                            <p className="text-xs text-green-600 font-medium mt-1">
                              {plan.trialDays}-day free trial included
                            </p>
                          )}
                        </div>

                        <ul className="space-y-2 text-sm">
                          <li className="flex items-center gap-2 text-slate-700">
                            <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                            {plan.isUnlimitedCredits ? "Unlimited credits" : `${plan.includedCredits.toLocaleString()} credits/mo`}
                          </li>
                          <li className="flex items-center gap-2 text-slate-700">
                            <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                            {plan.maxAgents === null || plan.maxAgents === undefined ? "Unlimited agents" : `Up to ${plan.maxAgents} agents`}
                          </li>
                          <li className="flex items-center gap-2 text-slate-700">
                            <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                            {plan.maxPhoneNumbers === null || plan.maxPhoneNumbers === undefined ? "Unlimited phone numbers" : `${plan.maxPhoneNumbers} phone number${plan.maxPhoneNumbers !== 1 ? "s" : ""}`}
                          </li>
                          {plan.features.slice(0, 3).map((f, i) => (
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
                        >
                          {(isMutating && confirmDialog.tierCode === plan.tierCode) ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirecting…</>
                          ) : isCurrent ? (
                            "Current Plan"
                          ) : isEnterprise ? (
                            <><ExternalLink className="w-4 h-4 mr-2" /> Contact Sales</>
                          ) : isSubscribed ? (
                            isUpgrade ? "Upgrade →" : "Downgrade"
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
          </div>

          {/* Billing History */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Billing History</CardTitle>
              <CardDescription>Recent billing events and transactions</CardDescription>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !history || history.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">No billing events yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {history.map((event) => {
                    const meta = EVENT_LABELS[event.eventType] ?? {
                      label: event.eventType,
                      icon: <CreditCard className="w-4 h-4" />,
                      color: "text-slate-600",
                    };
                    return (
                      <div key={event.id} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          <span className={meta.color}>{meta.icon}</span>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{meta.label}</p>
                            <p className="text-xs text-slate-400">
                              {event.fromTier && event.toTier
                                ? `${event.fromTier} → ${event.toTier}`
                                : event.toTier
                                  ? `Plan: ${event.toTier}`
                                  : event.fromTier
                                    ? `Plan: ${event.fromTier}`
                                    : ""}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          {event.amountCents != null && event.amountCents > 0 && (
                            <p className="text-sm font-medium text-slate-900">
                              ${(event.amountCents / 100).toFixed(2)}
                            </p>
                          )}
                          <p className="text-xs text-slate-400">
                            {new Date(event.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(o) => !isMutating && setConfirmDialog({ ...confirmDialog, open: o })}>
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
