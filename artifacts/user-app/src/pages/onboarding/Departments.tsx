import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPhoneNumbers,
  useListDepartments,
  usePurchasePhoneNumber,
  getListPhoneNumbersQueryKey,
  getListDepartmentsQueryKey,
  type AvailableNumberItem,
} from "@workspace/api-client-react";
import { getTenantToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  Phone,
  PhoneCall,
  ArrowRightLeft,
  MessageCircle,
  Facebook,
  Instagram,
  Globe,
  Mail,
  Headphones,
  Search,
  Loader2,
  AlertCircle,
  Check,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { SectionHeader } from "./components/SectionHeader";

type NumberType = "local" | "toll_free";

interface ChannelCard {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  iconClass: string;
  status: "active" | "soon";
  numberType?: NumberType;
}

const CHANNELS: ChannelCard[] = [
  {
    id: "local",
    title: "Get a Local Phone Number",
    description: "A standard 10-digit number with a local area code your customers recognize.",
    icon: Phone,
    iconClass: "bg-blue-50 text-blue-600",
    status: "active",
    numberType: "local",
  },
  {
    id: "toll_free",
    title: "Get a Toll-Free Number",
    description: "An 800-style number with no per-message carrier fees. Great for support lines.",
    icon: PhoneCall,
    iconClass: "bg-emerald-50 text-emerald-600",
    status: "active",
    numberType: "toll_free",
  },
  {
    id: "port",
    title: "Port an Existing Number",
    description: "Bring a number you already own from another carrier into Textitie.",
    icon: ArrowRightLeft,
    iconClass: "bg-violet-50 text-violet-600",
    status: "soon",
  },
  {
    id: "whatsapp",
    title: "WhatsApp Business",
    description: "Message customers on the world's most popular chat app.",
    icon: MessageCircle,
    iconClass: "bg-green-50 text-green-600",
    status: "soon",
  },
  {
    id: "messenger",
    title: "Facebook Messenger",
    description: "Connect your Page so messages land in the same shared inbox.",
    icon: Facebook,
    iconClass: "bg-sky-50 text-sky-600",
    status: "soon",
  },
  {
    id: "instagram",
    title: "Instagram DMs",
    description: "Reply to Instagram direct messages alongside your texts.",
    icon: Instagram,
    iconClass: "bg-pink-50 text-pink-600",
    status: "soon",
  },
  {
    id: "webchat",
    title: "Website Live Chat",
    description: "Add a chat widget so visitors can reach your team from your site.",
    icon: Globe,
    iconClass: "bg-indigo-50 text-indigo-600",
    status: "soon",
  },
  {
    id: "email",
    title: "Email Channel",
    description: "Turn inbound email into conversations your agents can manage.",
    icon: Mail,
    iconClass: "bg-amber-50 text-amber-600",
    status: "soon",
  },
  {
    id: "voice",
    title: "Voice & Calling",
    description: "Take and place calls on your Textitie numbers.",
    icon: Headphones,
    iconClass: "bg-rose-50 text-rose-600",
    status: "soon",
  },
];

const TOLL_FREE_NPA = new Set([
  "800", "822", "833", "844", "855", "866", "877",
  "880", "881", "882", "883", "884", "885", "886", "887", "888",
]);

function isTollFreeNumber(phone: string): boolean {
  const m = /^\+1(\d{3})/.exec(phone);
  return !!(m && TOLL_FREE_NPA.has(m[1]!));
}

function purchaseErrorMessage(err: unknown): string {
  const data = (err as { data?: { error?: string } } | null)?.data;
  if (data?.error) return data.error;
  const msg = (err as Error | null)?.message;
  return (
    msg ||
    "Could not purchase this number. Self-serve purchasing may be disabled for your workspace — please contact your administrator."
  );
}

function GetNumberDialog({
  numberType,
  open,
  onOpenChange,
}: {
  numberType: NumberType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: departments } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() },
  });

  const isTollFree = numberType === "toll_free";

  const [areaCode, setAreaCode] = useState("");
  const [contains, setContains] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<AvailableNumberItem[]>([]);
  const [purchaseDeptId, setPurchaseDeptId] = useState<string>("");
  const [purchasing, setPurchasing] = useState<string | null>(null);

  // Reset transient state whenever the dialog is (re)opened for a type.
  useEffect(() => {
    if (open) {
      setAreaCode("");
      setContains("");
      setSearchError(null);
      setResults([]);
      setPurchasing(null);
    }
  }, [open, numberType]);

  // Default the purchase target to "Customer Service" (server auto-creates it
  // when omitted, but pre-selecting keeps the common case one click).
  useEffect(() => {
    if (!purchaseDeptId && departments && departments.length > 0) {
      const cs = departments.find(
        (d) => d.name.trim().toLowerCase() === "customer service",
      );
      setPurchaseDeptId((cs ?? departments[0]).id.toString());
    }
  }, [departments, purchaseDeptId]);

  const purchaseMutation = usePurchasePhoneNumber({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
        toast({
          title: "Number added",
          description: `${result.phoneNumber} is ready to send and receive texts.`,
        });
        setResults([]);
        setPurchasing(null);
        onOpenChange(false);
      },
      onError: () => setPurchasing(null),
    },
  });

  const canSearch = isTollFree ? true : areaCode.trim().length > 0;

  const runSearch = async () => {
    if (!canSearch) return;
    setIsSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const token = getTenantToken();
      const qs = new URLSearchParams({ country: "US", type: numberType, limit: "12" });
      if (!isTollFree && areaCode.trim()) qs.set("areaCode", areaCode.trim());
      if (isTollFree && contains.trim()) qs.set("contains", contains.trim());
      const res = await fetch(`/api/phone-numbers/available?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 503) {
        setSearchError(
          "Telephony isn't configured for this workspace yet. Please contact your administrator.",
        );
      } else if (!res.ok) {
        setSearchError("Couldn't search for numbers right now. Please try again.");
      } else {
        const data = (await res.json()) as AvailableNumberItem[];
        setResults(data);
        if (data.length === 0) {
          setSearchError("No numbers matched your search. Try a different area code.");
        }
      }
    } catch {
      setSearchError("Network error while searching. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  const buy = (num: AvailableNumberItem) => {
    setPurchasing(num.phoneNumber);
    const deptId = purchaseDeptId ? parseInt(purchaseDeptId, 10) : undefined;
    purchaseMutation.mutate({
      data: { phoneNumber: num.phoneNumber, departmentId: deptId },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isTollFree ? "Get a Toll-Free Number" : "Get a Local Phone Number"}
          </DialogTitle>
          <DialogDescription>
            {isTollFree
              ? "Search available toll-free numbers and add one to your workspace."
              : "Search available numbers by area code and add one to your workspace."}
          </DialogDescription>
        </DialogHeader>

        {/* Billing disclosure */}
        {isTollFree ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <span className="font-semibold">No monthly carrier fees.</span>{" "}
            Toll-free numbers are billed at <span className="font-semibold">$0/mo</span> on top of your plan.
          </div>
        ) : (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <span className="font-semibold">$15/mo carrier fee</span> per local number.
            New numbers also carry a <span className="font-semibold">$10/mo</span> unregistered
            surcharge until registered — your admin can waive this for your account.
          </div>
        )}

        {/* Search controls */}
        <div className="flex items-end gap-3">
          {isTollFree ? (
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="tf-contains" className="text-xs uppercase tracking-wide text-slate-500">
                Contains digits (optional)
              </Label>
              <Input
                id="tf-contains"
                value={contains}
                onChange={(e) => setContains(e.target.value)}
                placeholder="e.g. 888 or 4357"
                data-testid="input-tollfree-contains"
              />
            </div>
          ) : (
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="local-areacode" className="text-xs uppercase tracking-wide text-slate-500">
                Area code
              </Label>
              <Input
                id="local-areacode"
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value)}
                placeholder="e.g. 415"
                data-testid="input-local-areacode"
              />
            </div>
          )}
          <Button
            onClick={runSearch}
            disabled={isSearching || !canSearch}
            className="bg-blue-600 hover:bg-blue-700"
            data-testid="button-search-numbers"
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Search className="w-4 h-4 mr-2" />
            )}
            Search
          </Button>
        </div>

        {searchError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No results</AlertTitle>
            <AlertDescription>{searchError}</AlertDescription>
          </Alert>
        )}

        {purchaseMutation.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Purchase unavailable</AlertTitle>
            <AlertDescription>{purchaseErrorMessage(purchaseMutation.error)}</AlertDescription>
          </Alert>
        )}

        {results.length > 0 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-slate-500">
                Assign to department
              </Label>
              <Select value={purchaseDeptId} onValueChange={setPurchaseDeptId}>
                <SelectTrigger data-testid="select-purchase-department">
                  <SelectValue placeholder="Customer Service (auto-created)" />
                </SelectTrigger>
                <SelectContent>
                  {departments?.map((d) => (
                    <SelectItem key={d.id} value={d.id.toString()}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
              {results.map((num) => (
                <div
                  key={num.phoneNumber}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  data-testid={`result-${num.phoneNumber}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{num.friendlyName}</p>
                    <p className="text-xs text-slate-400">
                      {num.locality ? `${num.locality}, ` : ""}
                      {num.region ?? (isTollFree ? "Toll-free" : "")} {num.isoCountry}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-shrink-0 text-blue-600 border-blue-200 hover:bg-blue-50"
                    disabled={purchaseMutation.isPending}
                    onClick={() => buy(num)}
                    data-testid={`button-buy-${num.phoneNumber}`}
                  >
                    {purchasing === num.phoneNumber ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Add number"
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Departments() {
  const { data: phoneNumbers, isLoading } = useListPhoneNumbers({
    query: { queryKey: getListPhoneNumbersQueryKey() },
  });

  const [activeType, setActiveType] = useState<NumberType | null>(null);

  return (
    <div>
      <SectionHeader
        title="Channels"
        subtitle="Choose how customers reach you. Start by getting a phone number — more channels are on the way."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CHANNELS.map((c) => {
          const Icon = c.icon;
          const active = c.status === "active";
          return (
            <button
              key={c.id}
              type="button"
              disabled={!active}
              onClick={() => active && c.numberType && setActiveType(c.numberType)}
              data-testid={`channel-${c.id}`}
              className={`group relative text-left rounded-xl border bg-white p-5 transition-all ${
                active
                  ? "border-slate-200 hover:border-blue-300 hover:shadow-md cursor-pointer"
                  : "border-slate-200 opacity-70 cursor-not-allowed"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${c.iconClass}`}>
                  <Icon className="w-5 h-5" />
                </div>
                {active ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                    <Check className="w-3.5 h-3.5" /> Available
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    Coming soon
                  </span>
                )}
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-900">{c.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{c.description}</p>
            </button>
          );
        })}
      </div>

      {/* Acquired numbers */}
      <div className="mt-10">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Your numbers</h2>
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !phoneNumbers || phoneNumbers.length === 0 ? (
              <div className="text-center py-10">
                <Phone className="w-9 h-9 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">
                  No numbers yet. Add a local or toll-free number to start texting.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {phoneNumbers.map((pn, i) => {
                  const tollFree = isTollFreeNumber(pn.phoneNumber);
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 px-6 py-4"
                      data-testid={`number-row-${pn.phoneNumber}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">{pn.phoneNumber}</p>
                        <p className="text-xs text-slate-400">{pn.departmentName}</p>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          tollFree
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {tollFree ? "Toll-free" : "Local"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {activeType && (
        <GetNumberDialog
          numberType={activeType}
          open={activeType !== null}
          onOpenChange={(o) => {
            if (!o) setActiveType(null);
          }}
        />
      )}
    </div>
  );
}
