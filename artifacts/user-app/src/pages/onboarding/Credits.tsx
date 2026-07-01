import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCampaignCredits,
  useGetBillingUsage,
  useTenantMe,
  useCreateCreditCheckout,
  getGetCampaignCreditsQueryKey,
} from "@workspace/api-client-react";
import { Coins, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "./components/SectionHeader";
import { GoLiveNotice } from "./components/GoLiveNotice";

const MIN_BACKUP_CREDITS = 250;
// Keep in sync with MIN_CREDIT_PURCHASE on the server (Stripe's $0.50 charge floor).
const MIN_ADDON_PURCHASE = 100;

export default function Credits() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: credits, isLoading: creditsLoading } = useGetCampaignCredits();
  const { data: usage } = useGetBillingUsage();
  const { data: me } = useTenantMe();
  const isOwner = me?.user?.role === "owner";

  const [buyAmount, setBuyAmount] = useState<string>("");
  const [lowThreshold, setLowThreshold] = useState<string>("0");
  const [backupAmount, setBackupAmount] = useState<string>(String(MIN_BACKUP_CREDITS));

  const addOnRateCents = usage?.overageRateCents ?? 3;

  // Surface the result of a returning Stripe Checkout redirect (success/cancel),
  // then strip the query param so a refresh doesn't re-toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const topup = params.get("topup");
    if (topup === "success") {
      queryClient.invalidateQueries({ queryKey: getGetCampaignCreditsQueryKey() });
      toast({
        title: "Payment received",
        description: "Your add-on credits are being added — the balance updates within a moment.",
      });
    } else if (topup === "canceled") {
      toast({ title: "Checkout canceled", description: "No charge was made.", variant: "destructive" });
    }
    if (topup) {
      params.delete("topup");
      const qs = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
  }, [queryClient, toast]);

  const checkoutMutation = useCreateCreditCheckout({
    mutation: {
      onSuccess: (result) => {
        // Hand off to Stripe's hosted checkout page.
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

            {/* Auto-recharge (NOT yet persisted — go-live gated) */}
            <div className="space-y-3 pt-2">
              <p className="text-sm font-medium text-slate-700">Automatic backup credits</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-slate-600">
                <span>If my account gets low and reaches</span>
                <Input
                  type="number"
                  min={0}
                  className="w-20 h-8"
                  value={lowThreshold}
                  onChange={(e) => setLowThreshold(e.target.value)}
                  disabled
                  data-testid="input-low-threshold"
                />
                <span>credits, then automatically buy</span>
                <Input
                  type="number"
                  min={MIN_BACKUP_CREDITS}
                  className="w-20 h-8"
                  value={backupAmount}
                  onChange={(e) => setBackupAmount(e.target.value)}
                  disabled
                  data-testid="input-backup-amount"
                />
                <span>backup credits.</span>
              </div>
              <p className="text-xs text-slate-400">There is a minimum of {MIN_BACKUP_CREDITS} backup credits.</p>
              <GoLiveNotice>
                Automatic backup-credit purchases are coming soon — these settings are not yet saved.
                In the meantime, buy add-on credits manually above (charged securely via Stripe).
              </GoLiveNotice>
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
