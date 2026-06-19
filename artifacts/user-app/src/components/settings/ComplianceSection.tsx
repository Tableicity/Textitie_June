import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Shield, ShieldCheck } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/apiFetch";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface TenantSettings {
  id: number;
  name: string;
  tierCode: string;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  quietHoursTz: string | null;
  frequencyCapPerDay: number | null;
  requireDoubleOptIn: boolean;
  hipaaEnabled: boolean;
  baaAcknowledgedAt: string | null;
  hipaaEligible: boolean | null;
  engagementMode: "assisted" | "gated_auto";
}

interface OptInItem {
  id: number;
  phone: string;
  source: string;
  consentedAt: string;
  revokedAt: string | null;
  evidenceUrl: string | null;
  note: string | null;
}

export default function ComplianceSection() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery<TenantSettings>({
    queryKey: ["tenant-settings/me"],
    queryFn: () => apiFetch<TenantSettings>("/tenant-settings/me"),
  });

  const [draft, setDraft] = useState({
    quietHoursStart: "" as string,
    quietHoursEnd: "" as string,
    quietHoursTz: "America/New_York",
    frequencyCapPerDay: "0",
    requireDoubleOptIn: false,
  });

  useEffect(() => {
    if (!settings) return;
    setDraft({
      quietHoursStart: settings.quietHoursStart == null ? "" : String(settings.quietHoursStart),
      quietHoursEnd: settings.quietHoursEnd == null ? "" : String(settings.quietHoursEnd),
      quietHoursTz: settings.quietHoursTz ?? "America/New_York",
      frequencyCapPerDay: String(settings.frequencyCapPerDay ?? 0),
      requireDoubleOptIn: !!settings.requireDoubleOptIn,
    });
  }, [settings]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      const parseHour = (s: string): number | null => {
        if (s.trim() === "") return null;
        const n = Number(s);
        if (!Number.isInteger(n) || n < 0 || n > 23) throw new Error("Quiet hours must be 0-23");
        return n;
      };
      const cap = Number(draft.frequencyCapPerDay);
      if (!Number.isInteger(cap) || cap < 0 || cap > 1000)
        throw new Error("Frequency cap must be 0-1000");
      return apiFetch<TenantSettings>("/tenant-settings/me", {
        method: "PATCH",
        body: JSON.stringify({
          quietHoursStart: parseHour(draft.quietHoursStart),
          quietHoursEnd: parseHour(draft.quietHoursEnd),
          quietHoursTz: draft.quietHoursTz.trim() || "America/New_York",
          frequencyCapPerDay: cap,
          requireDoubleOptIn: draft.requireDoubleOptIn,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-settings/me"] });
    },
  });

  const saveEngagementMode = useMutation({
    mutationFn: (mode: "assisted" | "gated_auto") =>
      apiFetch<TenantSettings>("/tenant-settings/me", {
        method: "PATCH",
        body: JSON.stringify({ engagementMode: mode }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-settings/me"] }),
  });

  const ackHipaa = useMutation({
    mutationFn: () =>
      apiFetch<TenantSettings>("/tenant-settings/hipaa/acknowledge", { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-settings/me"] }),
  });

  const disableHipaa = useMutation({
    mutationFn: () =>
      apiFetch<TenantSettings>("/tenant-settings/hipaa/disable", { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-settings/me"] }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            TCPA Compliance Controls
          </CardTitle>
          <CardDescription>
            Quiet hours, frequency caps, and consent rules are enforced on every outbound message.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || !settings ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-4 max-w-2xl">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Quiet hours start (0-23)</Label>
                  <Input
                    placeholder="21"
                    value={draft.quietHoursStart}
                    onChange={(e) => setDraft((d) => ({ ...d, quietHoursStart: e.target.value }))}
                    data-testid="compliance-quiet-start"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Quiet hours end (0-23)</Label>
                  <Input
                    placeholder="8"
                    value={draft.quietHoursEnd}
                    onChange={(e) => setDraft((d) => ({ ...d, quietHoursEnd: e.target.value }))}
                    data-testid="compliance-quiet-end"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Timezone (IANA)</Label>
                  <Input
                    placeholder="America/New_York"
                    value={draft.quietHoursTz}
                    onChange={(e) => setDraft((d) => ({ ...d, quietHoursTz: e.target.value }))}
                    data-testid="compliance-quiet-tz"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Leave start/end blank to disable quiet hours. Outbound messages during the window
                return an error to the agent.
              </p>

              <div>
                <Label className="text-xs text-slate-500 mb-1 block">
                  Frequency cap (messages per recipient per day)
                </Label>
                <Input
                  className="max-w-xs"
                  placeholder="0 = no cap"
                  value={draft.frequencyCapPerDay}
                  onChange={(e) => setDraft((d) => ({ ...d, frequencyCapPerDay: e.target.value }))}
                  data-testid="compliance-frequency-cap"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Switch
                  checked={draft.requireDoubleOptIn}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, requireDoubleOptIn: v }))}
                  data-testid="compliance-double-opt-in"
                />
                <div>
                  <div className="text-sm font-medium">Require explicit opt-in record</div>
                  <div className="text-xs text-slate-500">
                    Block outbound to any phone without a recorded, non-revoked opt-in.
                  </div>
                </div>
              </div>

              {saveSettings.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Could not save</AlertTitle>
                  <AlertDescription>{(saveSettings.error as Error).message}</AlertDescription>
                </Alert>
              )}
              {saveSettings.isSuccess && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Saved</AlertTitle>
                  <AlertDescription>Compliance settings updated.</AlertDescription>
                </Alert>
              )}

              <Button
                onClick={() => saveSettings.mutate()}
                disabled={saveSettings.isPending}
                className="bg-blue-600 hover:bg-blue-700"
                data-testid="compliance-save"
              >
                {saveSettings.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            AI Auto-Reply
          </CardTitle>
          <CardDescription>
            Choose how the AI Assistant handles inbound texts. Auto-send is gated — it only fires on
            high-confidence answers grounded in your published knowledge, in safe topics, with no
            unresolved conflicts, and only when outbound compliance passes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || !settings ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="space-y-4 max-w-2xl">
              <div className="flex items-center gap-3">
                <Switch
                  checked={settings.engagementMode === "gated_auto"}
                  disabled={saveEngagementMode.isPending}
                  onCheckedChange={(v) =>
                    saveEngagementMode.mutate(v ? "gated_auto" : "assisted")
                  }
                  data-testid="engagement-mode-toggle"
                />
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    Gated auto-send
                    {saveEngagementMode.isPending && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                    )}
                    <Badge variant="outline">
                      {settings.engagementMode === "gated_auto" ? "On" : "Off"}
                    </Badge>
                  </div>
                  <div className="text-xs text-slate-500">
                    When off (Assisted), the AI only drafts a private reply for your agent to review
                    and send. When on, it may send safe answers automatically; everything else still
                    falls back to an agent draft.
                  </div>
                </div>
              </div>

              {saveEngagementMode.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Could not update</AlertTitle>
                  <AlertDescription>
                    {(saveEngagementMode.error as Error).message}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <OptInsCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            HIPAA Mode
          </CardTitle>
          <CardDescription>
            Enable PHI-redacted logging and acknowledge a Business Associate Agreement (BAA).
            Available on HIPAA-eligible plans.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || !settings ? (
            <Skeleton className="h-20 w-full" />
          ) : settings.hipaaEnabled ? (
            <div className="space-y-3 max-w-2xl">
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>HIPAA Mode is active</AlertTitle>
                <AlertDescription>
                  PHI redaction is enabled in server logs. BAA acknowledged on{" "}
                  {settings.baaAcknowledgedAt
                    ? new Date(settings.baaAcknowledgedAt).toLocaleString()
                    : "unknown"}
                  .
                </AlertDescription>
              </Alert>
              <Button
                variant="outline"
                onClick={() => disableHipaa.mutate()}
                disabled={disableHipaa.isPending}
                data-testid="hipaa-disable"
              >
                {disableHipaa.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Disable HIPAA Mode
              </Button>
            </div>
          ) : !settings.hipaaEligible ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Plan not HIPAA-eligible</AlertTitle>
              <AlertDescription>
                Your current plan ({settings.tierCode}) is not HIPAA-eligible. Upgrade to Enterprise
                to enable HIPAA Mode.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3 max-w-2xl">
              <p className="text-sm text-slate-600">
                Acknowledging the BAA enables PHI redaction across server logs and is recorded in
                the audit log with your user ID and timestamp.
              </p>
              {ackHipaa.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Could not enable</AlertTitle>
                  <AlertDescription>{(ackHipaa.error as Error).message}</AlertDescription>
                </Alert>
              )}
              <Dialog>
                <DialogTrigger asChild>
                  <Button className="bg-emerald-600 hover:bg-emerald-700" data-testid="hipaa-acknowledge-btn">
                    <ShieldCheck className="w-4 h-4 mr-2" />
                    Acknowledge BAA & Enable HIPAA Mode
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Acknowledge Business Associate Agreement</DialogTitle>
                    <DialogDescription>
                      By acknowledging, you agree to the Textitie Business Associate Agreement
                      governing PHI handling under HIPAA. PHI redaction will be enabled across all
                      server logs immediately. Your acknowledgement is recorded in the audit log.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      onClick={() => ackHipaa.mutate()}
                      disabled={ackHipaa.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700"
                      data-testid="hipaa-acknowledge-confirm"
                    >
                      {ackHipaa.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      I acknowledge — enable HIPAA Mode
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OptInsCard() {
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("agent_collected");
  const [createError, setCreateError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<OptInItem[]>({
    queryKey: ["opt-ins"],
    queryFn: () => apiFetch<OptInItem[]>("/opt-ins"),
  });

  const createOptIn = useMutation({
    mutationFn: () =>
      apiFetch<OptInItem>("/opt-ins", {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim(), source }),
      }),
    onSuccess: () => {
      setPhone("");
      setCreateError(null);
      qc.invalidateQueries({ queryKey: ["opt-ins"] });
    },
    onError: (err) => {
      setCreateError(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  const revoke = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/opt-ins/${id}/revoke`, { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["opt-ins"] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consent Records (Opt-Ins)</CardTitle>
        <CardDescription>
          Explicit consent records are required when "Require explicit opt-in" is on. STOP keywords
          revoke consent automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-2 mb-4 max-w-2xl">
          <Input
            placeholder="+14155551234"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            data-testid="optin-phone"
          />
          <select
            className="border border-slate-200 rounded-md px-3 py-2 text-sm bg-white"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            data-testid="optin-source"
          >
            <option value="web_form">Web form</option>
            <option value="keyword">Keyword</option>
            <option value="agent_collected">Agent collected</option>
            <option value="imported">Imported</option>
          </select>
          <Button
            onClick={() => phone.trim() && createOptIn.mutate()}
            disabled={createOptIn.isPending || !phone.trim()}
            data-testid="optin-record"
          >
            {createOptIn.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Record
          </Button>
        </div>
        {createError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{createError}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (data?.length ?? 0) === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">No opt-in records yet.</div>
        ) : (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2 text-left">Phone</th>
                  <th className="px-3 py-2 text-left">Source</th>
                  <th className="px-3 py-2 text-left">Consented</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.map((row) => (
                  <tr key={row.id} data-testid={`optin-row-${row.id}`}>
                    <td className="px-3 py-2 font-mono text-xs">{row.phone}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{row.source}</Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {new Date(row.consentedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {row.revokedAt ? (
                        <Badge variant="destructive">Revoked</Badge>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                          Active
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!row.revokedAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600"
                          onClick={() => revoke.mutate(row.id)}
                          disabled={revoke.isPending}
                          data-testid={`optin-revoke-${row.id}`}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
