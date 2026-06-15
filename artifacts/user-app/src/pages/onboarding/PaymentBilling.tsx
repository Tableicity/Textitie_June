import {
  useGetBillingHistory,
} from "@workspace/api-client-react";
import {
  CreditCard,
  Check,
  Clock,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  XCircle,
  Lock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionHeader } from "./components/SectionHeader";
import { GoLiveNotice } from "./components/GoLiveNotice";

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

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PaymentHistory() {
  const { data: history, isLoading } = useGetBillingHistory();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <div className="text-center py-10">
        <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-sm">No payment history yet.</p>
      </div>
    );
  }

  return (
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
                <p className="text-sm font-medium text-slate-900">${(event.amountCents / 100).toFixed(2)}</p>
              )}
              <p className="text-xs text-slate-400">{new Date(event.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CreditCardForm() {
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 12 }, (_, i) => String(thisYear + i));

  return (
    <div className="space-y-5">
      <GoLiveNotice>
        Secure card capture activates at billing go-live and is handled directly by Stripe. This form is a
        preview — no card details are transmitted or stored.
      </GoLiveNotice>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-900">Credit Card Info</h3>
        </div>
        <p className="text-xs text-slate-500">Textitie uses industry-standard encryption to protect your data.</p>
      </div>

      {/* Uncontrolled inputs: nothing is captured to state or sent anywhere. */}
      <fieldset className="space-y-4 opacity-90" disabled>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-slate-500">Cardholder's name</Label>
          <Input placeholder="Jane Doe" autoComplete="off" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-slate-500">Card number</Label>
            <Input placeholder="•••• •••• •••• ••••" autoComplete="off" inputMode="numeric" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-slate-500">Expiration</Label>
            <div className="flex gap-2">
              <select className={SELECT_CLASS} defaultValue={months[new Date().getMonth()]}>
                {months.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select className={SELECT_CLASS} defaultValue={years[0]}>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-slate-500">CVC</Label>
            <Input placeholder="•••" autoComplete="off" inputMode="numeric" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-slate-500">Street address</Label>
            <Input autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-slate-500">Apt/Suite</Label>
            <Input autoComplete="off" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-slate-500">City</Label>
            <Input autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-slate-500">State/Province</Label>
            <Input autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-slate-500">ZIP/Postal code</Label>
            <Input autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-slate-500">Country</Label>
            <select className={SELECT_CLASS} defaultValue="US">
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="GB">United Kingdom</option>
              <option value="DE">Germany</option>
              <option value="AU">Australia</option>
            </select>
          </div>
        </div>
      </fieldset>

      <Button disabled data-testid="button-save-card">Save card — available at billing go-live</Button>
    </div>
  );
}

export default function PaymentBilling() {
  return (
    <div>
      <SectionHeader title="Plan & Billing" />

      <Tabs defaultValue="billing">
        <TabsList>
          <TabsTrigger value="billing" data-testid="tab-billing">Billing</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-payment-history">Payment History</TabsTrigger>
          <TabsTrigger value="tax" data-testid="tab-tax-exemption">Tax Exemption</TabsTrigger>
        </TabsList>

        <TabsContent value="billing" className="mt-6">
          <Card>
            <CardContent className="p-6">
              <CreditCardForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment History</CardTitle>
            </CardHeader>
            <CardContent>
              <PaymentHistory />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tax Exemption</CardTitle>
            </CardHeader>
            <CardContent>
              <GoLiveNotice>
                Tax-exemption requests will be available at billing go-live. Reach out to support to apply an
                exemption certificate to your account in the meantime.
              </GoLiveNotice>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
