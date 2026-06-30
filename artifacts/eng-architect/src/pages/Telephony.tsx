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
  Phone,
  PhoneCall,
  Inbox,
  AlertTriangle,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetTelephonyNumbers } from "@workspace/api-client-react";

function NumberTypeBadge({ numberType }: { numberType: string }) {
  const isTollFree = numberType === "toll_free";
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize text-xs",
        isTollFree
          ? "text-sky-600 border-sky-300"
          : "text-violet-600 border-violet-300",
      )}
    >
      {numberType.replace("_", " ")}
    </Badge>
  );
}

function RegistrationBadge({ status }: { status: string }) {
  const registered = status === "registered";
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize text-xs",
        registered
          ? "text-emerald-600 border-emerald-300"
          : "text-amber-600 border-amber-300",
      )}
    >
      {status}
    </Badge>
  );
}

export default function Telephony() {
  const { data, isLoading, isError } = useGetTelephonyNumbers();

  const available = data?.available ?? [];
  const assigned = data?.assigned ?? [];
  const configured = data?.configured ?? false;

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex flex-col gap-3 border-b pb-6">
        <div className="flex items-center gap-3">
          <Phone className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Telephony</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Every phone number across the platform. <strong>Available</strong>{" "}
          numbers are owned by the connected Twilio account but not yet assigned
          to any tenant. <strong>Assigned</strong> numbers come from the
          canonical routing registry — the single source of truth for which
          number belongs to which tenant and department.
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <Inbox size={12} /> {available.length} available
          </Badge>
          <Badge variant="secondary" className="gap-1.5">
            <PhoneCall size={12} /> {assigned.length} assigned
          </Badge>
        </div>
      </div>

      {isError && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
            <AlertTriangle size={16} />
            Failed to load telephony data. Try again.
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && !configured && (
        <Card className="border-amber-300/60 bg-amber-50/50">
          <CardContent className="flex items-start gap-2 py-4 text-sm text-amber-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Twilio is not configured, so the platform&rsquo;s available number
              inventory can&rsquo;t be listed. Assigned numbers below come from
              the routing registry and are unaffected.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Available numbers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Inbox size={16} /> Available Numbers
          </CardTitle>
          <CardDescription>
            Owned by the Twilio account, not yet assigned to a tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone Number</TableHead>
                <TableHead>Friendly Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : available.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={2}
                    className="text-center py-8 text-muted-foreground"
                  >
                    {configured
                      ? "No unassigned numbers — every owned number is assigned."
                      : "Twilio not configured."}
                  </TableCell>
                </TableRow>
              ) : (
                available.map((n) => (
                  <TableRow key={n.phoneNumber}>
                    <TableCell className="font-mono">{n.phoneNumber}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {n.friendlyName && n.friendlyName !== n.phoneNumber ? (
                        n.friendlyName
                      ) : (
                        <em>—</em>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Assigned numbers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <PhoneCall size={16} /> Assigned Numbers
          </CardTitle>
          <CardDescription>
            From the canonical routing registry — number &rarr; tenant &rarr;
            department.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Registration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : assigned.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No numbers assigned to any tenant yet.
                  </TableCell>
                </TableRow>
              ) : (
                assigned.map((n) => (
                  <TableRow key={n.phoneNumber}>
                    <TableCell className="font-mono">{n.phoneNumber}</TableCell>
                    <TableCell>
                      <NumberTypeBadge numberType={n.numberType} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Building2
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <span className="font-medium">{n.tenantName}</span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {n.tenantSlug}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {n.departmentName ?? <em>—</em>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize text-xs">
                        {n.kind}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {n.numberType === "toll_free" ? (
                        <span className="text-xs text-muted-foreground">
                          n/a
                        </span>
                      ) : (
                        <RegistrationBadge status={n.registrationStatus} />
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
