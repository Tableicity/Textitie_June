import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Wrench,
  Lock,
  Layers,
  MessageSquare,
  ShieldCheck,
  Check,
  X,
  Phone,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TIERS = [
  {
    name: "Starter",
    price: "$149.00/mo",
    credits: "600 Credits",
    strategy: "Hard-stops at 0 if Backup is Off",
  },
  {
    name: "Growth",
    price: "$349.00/mo",
    credits: "2,000 Credits",
    strategy: "Unlimited AI Agent generation",
  },
  {
    name: "Enterprise",
    price: "Custom",
    credits: "Bespoke Pool",
    strategy: "Isolated Hetzner Silo Deployment",
  },
];

const OVERHEAD = [
  {
    label: "Pass-Through Number Fee",
    amount: "$15.00/mo",
    note: "Added to all live Stripe invoices",
  },
  {
    label: "Unregistered Surcharge",
    amount: "$10.00/mo",
    note: "Applied continuously until A2P 10DLC is approved",
  },
];

const BUCKETS = [
  {
    order: "1",
    name: "Included Pool",
    rule: "Resets to plan amount at the monthly cycle boundary.",
    tag: "No Rollover",
    dot: "bg-emerald-500",
    ring: "border-emerald-500/30",
    badge: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  },
  {
    order: "2",
    name: "Add-On Packs",
    rule: "Purchased at $0.03/credit ($15 / $30 / $150 packs). Cash asset.",
    tag: "Rolls Over",
    dot: "bg-blue-500",
    ring: "border-blue-500/30",
    badge: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  {
    order: "3",
    name: "Backup Credits",
    rule: "Triggers at 0 balance in $10 blocks (250 credits @ $0.04/credit).",
    tag: "Auto-Replenish",
    dot: "bg-red-500",
    ring: "border-red-500/30",
    badge: "bg-red-500/10 text-red-500 border-red-500/20",
  },
];

const SEGMENTATION = [
  {
    label: "Standard SMS",
    detail: "Text only, GSM-7",
    rate: "1 Credit / 160 characters",
  },
  {
    label: "Multi-Segment Text",
    detail: "GSM-7, 7-char concatenation headers applied",
    rate: "1 Credit / 153 characters",
  },
  {
    label: "Emoji Drop Penalty",
    detail: "UCS-2, triggered by a single emoji / special char",
    rate: "1 Credit / 70 characters",
  },
  {
    label: "Document / Media (MMS)",
    detail: "Inbound & outbound: PDFs, vCards, PNGs",
    rate: "3 Credits flat / message",
  },
];

const REJECTED = [
  { code: "21610", label: "Stop / Opt-Out" },
  { code: "21211", label: "Invalid Format / Landline check" },
];

const FAILED = [
  { code: "30007", label: "Carrier / Spam Filter Block" },
  { code: "30003", label: "Unreachable / Dead Handset Network drop" },
];

function SectionHeading({
  index,
  title,
  icon: Icon,
}: {
  index: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">
        <span className="font-mono text-muted-foreground mr-2">
          {index}
        </span>
        {title}
      </h2>
    </div>
  );
}

export default function CreditPricing() {
  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex flex-col gap-3 border-b pb-6">
        <div className="flex items-center gap-3">
          <Wrench className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">
            Global Billing &amp; Rate Card Blueprint
          </h1>
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-500"
          >
            <Lock className="h-3 w-3" />
            Read-Only Reference
          </Badge>
        </div>
        <p className="max-w-3xl text-muted-foreground">
          This page is the structural source of truth for the core billing engine
          wired into Stripe and the database waterfall. Values shown here mirror
          the deduction logic shipped in the API server — they are documentation,
          not editable settings.
        </p>
      </div>

      {/* SECTION 1 — Tiers & overhead */}
      <section className="space-y-4">
        <SectionHeading
          index="01"
          title="Monthly Subscription Tiers & Carrier Overhead"
          icon={Layers}
        />
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier Name</TableHead>
                  <TableHead>Base Price</TableHead>
                  <TableHead>Incl. Credits</TableHead>
                  <TableHead>Overage Actions / Strategy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TIERS.map((tier) => (
                  <TableRow key={tier.name}>
                    <TableCell className="font-semibold">{tier.name}</TableCell>
                    <TableCell className="font-mono">{tier.price}</TableCell>
                    <TableCell className="font-mono">{tier.credits}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {tier.strategy}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {OVERHEAD.map((item) => (
            <Card key={item.label}>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Phone className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.label}</span>
                    <span className="font-mono text-sm text-primary">
                      {item.amount}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.note}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Overhead fees are billed as Stripe line items and are never deducted
          from the credit buckets.
        </p>
      </section>

      {/* SECTION 2 — Waterfall */}
      <section className="space-y-4">
        <SectionHeading
          index="02"
          title="The 3-Bucket Waterfall Engine (Deduction Logic)"
          icon={Layers}
        />
        <p className="text-sm text-muted-foreground">
          Every routing event queries the DB and drains assets in this strict
          order:
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {BUCKETS.map((bucket) => (
            <Card key={bucket.name} className={cn("border", bucket.ring)}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 rounded-full", bucket.dot)} />
                    <CardTitle className="text-base">
                      <span className="font-mono text-muted-foreground mr-2">
                        {bucket.order}
                      </span>
                      {bucket.name}
                    </CardTitle>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn("mt-2 w-fit", bucket.badge)}
                >
                  {bucket.tag}
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground/80">{bucket.rule}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* SECTION 3 — Segmentation */}
      <section className="space-y-4">
        <SectionHeading
          index="03"
          title="Protocol & Segmentation Rates"
          icon={MessageSquare}
        />
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Message Type</TableHead>
                  <TableHead>Protocol / Trigger</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SEGMENTATION.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.detail}
                    </TableCell>
                    <TableCell className="text-right font-mono text-primary">
                      {row.rate}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {/* SECTION 4 — Gateway status & refunds */}
      <section className="space-y-4">
        <SectionHeading
          index="04"
          title="Gateway Status & Refund Mapping"
          icon={ShieldCheck}
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="border-emerald-500/30">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-500" />
                <CardTitle className="text-base">Rejected</CardTitle>
              </div>
              <CardDescription>No Charge — Auto-Refund Credit</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {REJECTED.map((row) => (
                <div
                  key={row.code}
                  className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2"
                >
                  <Badge
                    variant="outline"
                    className="border-emerald-500/20 bg-emerald-500/10 font-mono text-emerald-500"
                  >
                    {row.code}
                  </Badge>
                  <span className="text-sm text-foreground/80">{row.label}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-red-500/30">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <X className="h-4 w-4 text-red-500" />
                <CardTitle className="text-base">Failed / Undelivered</CardTitle>
              </div>
              <CardDescription>Charge Stands — No Refund</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {FAILED.map((row) => (
                <div
                  key={row.code}
                  className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2"
                >
                  <Badge
                    variant="outline"
                    className="border-red-500/20 bg-red-500/10 font-mono text-red-500"
                  >
                    {row.code}
                  </Badge>
                  <span className="text-sm text-foreground/80">{row.label}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Carrier-billed failures (spam blocks, dead handsets) keep the charge to
          protect margins; only true carrier rejections are refunded.
        </p>
      </section>
    </div>
  );
}
