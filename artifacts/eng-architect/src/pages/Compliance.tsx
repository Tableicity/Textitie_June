import { useGetCompliance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, AlertTriangle, Clock, XCircle, Phone } from "lucide-react";

function statusBadge(status: string | null) {
  if (!status) return <Badge variant="outline" className="text-muted-foreground">Unknown</Badge>;
  const s = status.toLowerCase();
  if (s === "approved" || s === "twilio-approved" || s === "compliant")
    return <Badge className="bg-emerald-600 hover:bg-emerald-700">{status}</Badge>;
  if (s === "pending" || s === "in-review" || s === "pending-review")
    return <Badge variant="secondary" className="text-amber-600 border-amber-300">{status}</Badge>;
  if (s === "failed" || s === "rejected" || s === "non-compliant")
    return <Badge variant="destructive">{status}</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function statusIcon(status: string | null) {
  if (!status) return <Clock size={20} className="text-muted-foreground" />;
  const s = status.toLowerCase();
  if (s === "approved" || s === "twilio-approved" || s === "compliant")
    return <ShieldCheck size={20} className="text-emerald-500" />;
  if (s === "pending" || s === "in-review" || s === "pending-review")
    return <Clock size={20} className="text-amber-500" />;
  if (s === "failed" || s === "rejected" || s === "non-compliant")
    return <XCircle size={20} className="text-red-500" />;
  return <AlertTriangle size={20} className="text-muted-foreground" />;
}

export default function Compliance() {
  const { data, isLoading } = useGetCompliance();

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading compliance data...</div>;
  }

  if (!data) {
    return <div className="p-8 text-center text-muted-foreground">Failed to load compliance data.</div>;
  }

  const items = [
    { label: "A2P Brand Registration", data: data.brandRegistration },
    { label: "Trust Hub A2P Bundle", data: data.trustHubBundle },
    { label: "Customer Profile", data: data.customerProfile },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">10DLC Compliance Monitor</h1>
        <p className="text-muted-foreground mt-2">
          Track US A2P 10DLC registration status to ensure carrier deliverability.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {items.map((item) => (
          <Card key={item.label}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">{item.label}</CardTitle>
                {statusIcon(item.data.status)}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                {statusBadge(item.data.status)}
              </div>
              {item.data.sid && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">SID</span>
                  <span className="font-mono text-xs text-muted-foreground truncate max-w-[160px]" title={item.data.sid}>
                    {item.data.sid}
                  </span>
                </div>
              )}
              {item.data.friendlyName && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Name</span>
                  <span className="text-sm truncate max-w-[160px]">{item.data.friendlyName}</span>
                </div>
              )}
              {item.data.detail && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">{item.data.detail}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone size={20} /> Tenant Number Inventory
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            All tenant numbers registered in SAMA. US numbers require 10DLC compliance for SMS deliverability.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>10DLC Required</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tenantNumbers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                    No tenants with numbers configured.
                  </TableCell>
                </TableRow>
              ) : (
                data.tenantNumbers.map((t) => (
                  <TableRow key={t.tenantSlug}>
                    <TableCell className="font-medium">{t.tenantName}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{t.tenantSlug}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {t.phoneNumber ?? <em className="text-muted-foreground">unset</em>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.region}</Badge>
                    </TableCell>
                    <TableCell>
                      {t.region === "US" ? (
                        <Badge variant="secondary" className="text-amber-600">Required</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">N/A</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
