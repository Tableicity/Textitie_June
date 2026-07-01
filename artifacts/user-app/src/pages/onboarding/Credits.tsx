import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCampaignCredits,
  useGetBillingUsage,
  useTenantMe,
  useCreateCreditCheckout,
  useGetBillingAutoRecharge,
  useUpdateBillingAutoRecharge,
  useCreateBillingAutoRechargeSetup,
  getGetCampaignCreditsQueryKey,
  getGetBillingAutoRechargeQueryKey,
} from "@workspace/api-client-react";
import { Coins, Loader2, CreditCard, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "./components/SectionHeader";

const MIN_BACKUP_CREDITS = 250;
// Keep in sync with MIN_CREDIT_PURCHASE on the server (Stripe's $0.50 charge floor).
const MIN_ADDON_PURCHASE = 100;

export default function Credits() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: credits, isLoading: creditsLoading } = useGetCampaignCredits();
  const { data: usage } = useGetBillingUsage();
  const { data: me } = useTenantMe();
  const { data: autoRecharge, isLoading: autoLoading } = useGetBillingAutoRecharge();
  const isOwner = me?.user?.role === "owner";

  const [buyAmount, setBuyAmount] = useState<string>("");
  const [enabled, setEnabled] = useState<boolean>(false);
  const [lowThreshold, setLowThreshold] = useState<string>("0");
  const [backupAmount, setBackupAmount] = useState<string>(String(MIN_BACKUP_CREDITS));
  const [seeded, setSeeded] = useState(false);

  const addOnRateCents = usage?.overageRateCents ?? 3;
  const blockSize = autoRecharge?.blockSizeCredits ?? MIN_BACKUP_CREDITS;
  const blockPriceCents = autoRecharge?.blockPriceCents ?? 1000;

  // Seed the local form from persisted settings once, so the owner's in-progress
  // edits are never clobbered by a background refetch.
  useEffect(() => {
    if (autoRecharge && !seeded) {
      setEnabled(autoRecharge.enabled);
      setLowThreshold(String(autoRecharge.thresholdCredits));
      setBackupAmount(String(autoRecharge.amountCredits));
      setSeeded(true);
    }
  }, [autoRecharge, seeded]);

  // Surface the result of a returning Stripe redirect (top-up OR card setup),
  // then strip the query param so a refresh doesn't re-toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const topup = params.get("topup");
    const setup = params.get("setup");
    if (topup === "success") {
      queryClient.invalidateQueries({ queryKey: getGetCampaignCreditsQueryKey() });
      toast({
        title: "Payment received",
        description: "Your add-on credits are being added — the balance updates within a moment.",
      });
    } else if (topup === "canceled") {
      toast({ title: "Checkout canceled", description: "No charge was made.", variant: "destructive" });
    }
    if (setup === "success") {
      queryClient.invalidateQueries({ queryKey: getGetBillingAutoRechargeQueryKey() });
      toast({
        title: "Card saved",
        description: "Your card is ready for automatic backup credits.",
      });
    } else if (setup === "canceled") {
      toast({ title: "Card setup canceled", description: "No card was saved.", variant: "destructive" });
    }
    if (topup || setup) {
      params.delete("topup");
      params.delete("setup");
      const qs = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
  }, [queryClient, toast]);

  const checkoutMutation = useCreateCreditCheckout({
    mutation: {
      onSuccess: (result) => {
        window.location.href = result.checkoutUrl;
      },
      onError: (err: any) => {
        toast({
          title: "Could not start checkout",
          description: err?.response?.data?.error ?? err?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const setupMutation = useCreateBillingAutoRechargeSetup({
    mutation: {
      onSuccess: (result) => {
        window.location.href = result.checkoutUrl;
      },
      onError: (err: any) => {
        toast({
          title: "Could not start card setup",
          description: err?.response?.data?.error ?? err?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const saveMutation = useUpdateBillingAutoRecharge({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBillingAutoRechargeQueryKey() });
        toast({ title: "Auto-recharge saved", description: "Your settings were updated." });
      },
      onError: (err: any) => {
        toast({
          title: "Could not save",
          description: err?.response?.data?.error ?? err?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const buyValue = parseInt(buyAmount, 10);
  const meetsMin = Number.isFinite(buyValue) && buyValue >= MIN_ADDON_PURCHASE;
  const canBuy = meetsMin && isOwner && !checkoutMutation.isPending;

  const handleBuy = () => {
    if (!canBuy) return;
    const base = import.meta.env.BASE_URL;
    const successUrl = `${window.location.origin}${base}onboarding/credits?topup=success`;
    const cancelUrl = `${window.location.origin}${base}onboarding/credits?topup=canceled`;
    checkoutMutation.mutate({ data: { credits: buyValue, successUrl, cancelUrl } });
  };

  const handleSaveCard = () => {
    if (!isOwner || setupMutation.isPending) return;
    const base = import.meta.env.BASE_URL;
    const successUrl = `${window.location.origin}${base}onboarding/credits?setup=success`;
    const cancelUrl = `${window.location.origin}${base}onboarding/credits?setup=canceled`;
    setupMutation.mutate({ data: { successUrl, cancelUrl } });
  };

  const hasCard = !!autoRecharge?.hasPaymentMethod;
  const thresholdValue = parseInt(lowThreshold, 10);
  const amountValue = parseInt(backupAmount, 10);
  const amountValid =
    Number.isFinite(amountValue) &&
    amountValue >= MIN_BACKUP_CREDITS &&
    amountValue % blockSize === 0;
  const thresholdValid = Number.isFinite(thresholdValue) && thresholdValue >= 0;
  // Enabling requires a saved card; the server enforces this too.
  const canSave =
    isOwner &&
    !saveMutation.isPending &&
    thresholdValid &&
    amountValid &&
    (!enabled || hasCard);

  const handleSave = () => {
    if (!canSave) return;
    saveMutation.mutate({
      data: {
        enabled,
        thresholdCredits: thresholdValue,
        amountCredits: amountValue,
      },
    });
  };

  const blocksPerRecharge = amountValid ? Math.ceil(amountValue / blockSize) : 0;
  const rechargeCostCents = blocksPerRecharge * blockPriceCents;
  const suspended = !!autoRecharge?.suspendedAt;

  return (
    <div>
      <SectionHeader title="Message credits" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Manage Credits */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="w-5 h-5 text-slate-500" />
              Manage Credits
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="border-b border-slate-100 pb-4">
              {creditsLoading ? (
                <Skeleton className="h-9 w-40" />
              ) : (
                <p className="text-3xl font-bold text-slate-900">
                  {(credits?.totalAvailable ?? 0).toLocaleString()}
                  <span className="text-sm font-normal text-slate-400 ml-2">credits available</span>
                </p>
              )}
              {!creditsLoading && (
                <p className="text-xs text-slate-400 mt-1">
                  {(credits?.prepaidCredits ?? 0).toLocaleString()} add-on +{" "}
                  {(credits?.includedRemaining ?? 0).toLocaleString()} included remaining
                </p>
              )}
            </div>

            {/* Buy add-on credits now (REAL) */}
            <div className="space-y-2">
              <Label htmlFor="buy-credits" className="text-sm font-medium text-slate-700">
                Buy Add-On Credits
              </Label>
              <div className="flex items-center gap-3">
                <Input
                  id="buy-credits"
                  type="number"
                  min={MIN_ADDON_PURCHASE}
                  step={1}
                  placeholder="e.g. 500"
                  className="max-w-[160px]"
                  value={buyAmount}
                  onChange={(e) => setBuyAmount(e.target.value)}
                  disabled={!isOwner}
                  data-testid="input-buy-credits"
                />
                <Button onClick={handleBuy} disabled={!canBuy} data-testid="button-buy-credits">
                  {checkoutMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {checkoutMutation.isPending ? "Redirecting…" : "Buy credits"}
                </Button>
              </div>
              <p className="text-xs text-slate-400">
                Add-on credits cost ${(addOnRateCents / 100).toFixed(2)} each and roll over month to month.
                {" "}Minimum {MIN_ADDON_PURCHASE.toLocaleString()} credits per purchase. You'll be taken to
                Stripe's secure checkout to pay.
              </p>
              {!isOwner && (
                <p className="text-xs text-amber-600">
                  Only the workspace owner can buy credits. Ask your owner to top up.
                </p>
              )}
            </div>

            {/* Automatic backup credits (LIVE) */}
            <div className="space-y-3 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Automatic backup credits</p>
                {autoLoading ? (
                  <Skeleton className="h-6 w-10" />
                ) : (
                  <Switch
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    disabled={!isOwner || (!hasCard && !enabled)}
                    data-testid="switch-auto-recharge"
                  />
                )}
              </div>

              {suspended && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Auto-recharge was paused after repeated card declines
                    {autoRecharge?.lastFailureReason ? ` (${autoRecharge.lastFailureReason})` : ""}.
                    Update your card and turn it back on to resume.
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-slate-600">
                <span>If my account gets low and reaches</span>
                <Input
                  type="number"
                  min={0}
                  className="w-20 h-8"
                  value={lowThreshold}
                  onChange={(e) => setLowThreshold(e.target.value)}
                  disabled={!isOwner}
                  data-testid="input-low-threshold"
                />
                <span>credits, then automatically buy</span>
                <Input
                  type="number"
                  min={MIN_BACKUP_CREDITS}
                  step={blockSize}
                  className="w-24 h-8"
                  value={backupAmount}
                  onChange={(e) => setBackupAmount(e.target.value)}
                  disabled={!isOwner}
                  data-testid="input-backup-amount"
                />
                <span>backup credits.</span>
              </div>

              {!amountValid && (
                <p className="text-xs text-amber-600">
                  Backup amount must be a multiple of {blockSize} (minimum {MIN_BACKUP_CREDITS}).
                </p>
              )}
              {amountValid && (
                <p className="text-xs text-slate-400">
                  Each recharge buys {amountValue.toLocaleString()} backup credits for
                  {" "}${(rechargeCostCents / 100).toFixed(2)} (${(blockPriceCents / 100 / blockSize).toFixed(2)}/credit),
                  charged automatically to your saved card.
                </p>
              )}

              {/* Saved card + actions */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <CreditCard className="w-4 h-4 text-slate-400" />
                  {autoLoading ? (
                    <Skeleton className="h-4 w-32" />
                  ) : hasCard ? (
                    <span className="flex items-center gap-1.5" data-testid="text-saved-card">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      {autoRecharge?.cardBrand
                        ? autoRecharge.cardBrand.charAt(0).toUpperCase() + autoRecharge.cardBrand.slice(1)
                        : "Card"}{" "}
                      •••• {autoRecharge?.cardLast4 ?? "----"}
                      {autoRecharge?.cardExpMonth && autoRecharge?.cardExpYear
                        ? ` · exp ${String(autoRecharge.cardExpMonth).padStart(2, "0")}/${String(
                            autoRecharge.cardExpYear,
                          ).slice(-2)}`
                        : ""}
                    </span>
                  ) : (
                    <span className="text-slate-400">No card saved</span>
                  )}
                </div>
                {isOwner && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveCard}
                    disabled={setupMutation.isPending}
                    data-testid="button-save-card"
                  >
                    {setupMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {hasCard ? "Update card" : "Save a card"}
                  </Button>
                )}
              </div>

              {enabled && !hasCard && (
                <p className="text-xs text-amber-600">
                  Save a card first to turn on automatic backup credits.
                </p>
              )}

              {isOwner ? (
                <Button
                  onClick={handleSave}
                  disabled={!canSave}
                  size="sm"
                  data-testid="button-save-auto-recharge"
                >
                  {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save auto-recharge
                </Button>
              ) : (
                <p className="text-xs text-amber-600">
                  Only the workspace owner can change automatic backup credits.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Info */}
        <Card className="bg-slate-50/60">
          <CardHeader>
            <CardTitle className="text-base">Message credits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <p className="text-2xl font-bold text-slate-900">
              ${(addOnRateCents / 100).toFixed(2)}
              <span className="text-sm font-normal text-slate-400 ml-1">per add-on credit</span>
            </p>
            <p className="leading-relaxed">
              Add-on credits are prepaid and never expire — unused credits roll over to the next month.
              Backup credits are only purchased automatically once your account runs low and meets your
              threshold.
            </p>
            <p className="leading-relaxed text-slate-500">
              Each outbound SMS segment consumes one credit. Your plan's included credits are used first,
              then add-on credits.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
