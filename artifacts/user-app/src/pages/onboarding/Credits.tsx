import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCampaignCredits,
  useGetBillingUsage,
  useTopUpCredits,
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

export default function Credits() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: credits, isLoading: creditsLoading } = useGetCampaignCredits();
  const { data: usage } = useGetBillingUsage();

  const [buyAmount, setBuyAmount] = useState<string>("");
  const [lowThreshold, setLowThreshold] = useState<string>("0");
  const [backupAmount, setBackupAmount] = useState<string>(String(MIN_BACKUP_CREDITS));

  const addOnRateCents = usage?.overageRateCents ?? 3;

  const topUpMutation = useTopUpCredits({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignCreditsQueryKey() });
        setBuyAmount("");
        toast({ title: "Credits added", description: "Your add-on credits are now available." });
      },
      onError: (err: any) => {
        toast({ title: "Top-up failed", description: err?.response?.data?.error ?? "Please try again.", variant: "destructive" });
      },
    },
  });

  const buyValue = parseInt(buyAmount, 10);
  const canBuy = Number.isFinite(buyValue) && buyValue > 0 && !topUpMutation.isPending;

  const handleBuy = () => {
    if (!canBuy) return;
    topUpMutation.mutate({ data: { credits: buyValue } });
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
                  min={1}
                  placeholder="e.g. 500"
                  className="max-w-[160px]"
                  value={buyAmount}
                  onChange={(e) => setBuyAmount(e.target.value)}
                  data-testid="input-buy-credits"
                />
                <Button onClick={handleBuy} disabled={!canBuy} data-testid="button-buy-credits">
                  {topUpMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Buy credits
                </Button>
              </div>
              <p className="text-xs text-slate-400">
                Add-on credits cost ${(addOnRateCents / 100).toFixed(2)} each and roll over month to month.
              </p>
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
                Automatic backup-credit purchases activate when billing goes live. Until then, top up
                manually above — these settings are not yet saved.
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
