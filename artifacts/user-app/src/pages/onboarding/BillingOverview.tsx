import { Link } from "wouter";
import {
  useGetSubscription,
  useGetBillingUsage,
  useGetCampaignCredits,
  useListDepartments,
  useListAgents,
  useGetCarrierBillingSummary,
} from "@workspace/api-client-react";
import { CreditCard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "./components/SectionHeader";

const STATUS_LABEL: Record<string, string> = {
  none: "No Plan",
  trialing: "Free Trial",
  active: "Active",
  past_due: "Past Due",
  canceled: "Canceled",
};

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-semibold text-slate-900 mt-1">{value}</p>
    </div>
  );
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function BillingOverview() {
  const { data: subscription, isLoading: subLoading } = useGetSubscription();
  const { data: usage } = useGetBillingUsage();
  const { data: credits } = useGetCampaignCredits();
  const { data: departments } = useListDepartments();
  const { data: agents } = useListAgents();
  const { data: carrier } = useGetCarrierBillingSummary();

  const isSubscribed = subscription?.status === "active" || subscription?.status === "trialing";
  const basePrice = subscription?.monthlyPriceCents
    ? `$${(subscription.monthlyPriceCents / 100).toFixed(2)}`
    : "Free";
  const nextCharge = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
    : "—";
  const includedCredits = usage?.isUnlimited
    ? "Unlimited"
    : (usage?.creditsIncluded?.toLocaleString() ?? "0");

  return (
    <div>
      <SectionHeader
        title="Plan & Billing"
        subtitle="Your current selected plan details are below. To make changes to your plan, message credits, or other details use the options in the left sidebar. Dollar amounts do not include state sales tax."
      />

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-slate-900">Plan Overview</h2>
            {subLoading ? (
              <Skeleton className="h-5 w-20" />
            ) : (
              <Badge variant={isSubscribed ? "default" : "outline"}>
                {STATUS_LABEL[subscription?.status ?? "none"] ?? "Unknown"}
              </Badge>
            )}
          </div>

          {subLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !isSubscribed ? (
            <div className="text-center py-8">
              <CreditCard className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600 font-medium">No active plan</p>
              <p className="text-slate-400 text-sm mt-1 mb-4">
                Choose a plan to start your free trial.
              </p>
              <Link href="/plans">
                <Button>Choose Your Plan</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                <Stat label="Plan" value={subscription?.planName ?? "—"} />
                <Stat label="Departments" value={departments?.length ?? 0} />
                <Stat label="Active Agents" value={agents?.length ?? 0} />
                <Stat label="Included Credits" value={includedCredits} />
                <Stat label="Add-On Credits" value={(credits?.prepaidCredits ?? 0).toLocaleString()} />
              </div>

              <div className="border-t border-slate-100 mt-6 pt-5 grid grid-cols-2 md:grid-cols-5 gap-6">
                <Stat label="Base Plan" value={`${basePrice}${subscription?.monthlyPriceCents ? "/mo" : ""}`} />
                <Stat label="Next Charge" value={nextCharge} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {carrier && (carrier.localCount > 0 || carrier.tollFreeCount > 0) && (
        <Card className="mt-6">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-semibold text-slate-900">Phone Number Charges</h2>
              <Badge variant="outline">Recurring monthly</Badge>
            </div>
            <p className="text-sm text-slate-500 mb-5">
              Per-number carrier fees billed in addition to your base plan. Toll-free numbers have no recurring carrier fee.
            </p>

            <div className="divide-y divide-slate-100 border-t border-slate-100">
              <LineItem
                label="Local number carrier fee"
                detail={`${carrier.localCount} local ${carrier.localCount === 1 ? "number" : "numbers"} × ${money(carrier.carrierFeeCents)}/mo`}
                amount={money(carrier.carrierLineCents)}
              />
              {carrier.surchargeEnabled ? (
                <LineItem
                  label="Unregistered number surcharge"
                  detail={
                    carrier.unregisteredLocalCount > 0
                      ? `${carrier.unregisteredLocalCount} unregistered × ${money(carrier.surchargeCents)}/mo`
                      : "No unregistered numbers"
                  }
                  amount={money(carrier.surchargeLineCents)}
                />
              ) : (
                <LineItem
                  label="Unregistered number surcharge"
                  detail="Waived for your account"
                  amount="$0.00"
                  muted
                />
              )}
              {carrier.tollFreeCount > 0 && (
                <LineItem
                  label="Toll-free numbers"
                  detail={`${carrier.tollFreeCount} toll-free ${carrier.tollFreeCount === 1 ? "number" : "numbers"} · no carrier fee`}
                  amount="$0.00"
                  muted
                />
              )}
            </div>

            <div className="flex items-center justify-between pt-4 mt-1">
              <span className="text-sm font-semibold text-slate-900">Total recurring carrier charges</span>
              <span className="text-lg font-semibold text-slate-900">{money(carrier.totalRecurringCents)}/mo</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LineItem({
  label,
  detail,
  amount,
  muted,
}: {
  label: string;
  detail: string;
  amount: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{detail}</p>
      </div>
      <span className={`text-sm font-semibold ${muted ? "text-slate-400" : "text-slate-900"}`}>{amount}</span>
    </div>
  );
}
