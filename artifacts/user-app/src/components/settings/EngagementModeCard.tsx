import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, Shield } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { TenantSettingsEngagementMode } from "@workspace/api-client-react";
import type { TenantSettingsEngagementMode as EngagementMode } from "@workspace/api-client-react";

interface EngagementSettings {
  engagementMode: EngagementMode;
}

const ENGAGEMENT_MODE_OPTIONS: ReadonlyArray<{
  value: EngagementMode;
  label: string;
  dot: string;
  description: string;
}> = [
  {
    value: TenantSettingsEngagementMode.manual,
    label: "Manual",
    dot: "bg-blue-500",
    description:
      "AI is off. No drafts, no auto-sends, and nothing is learned. Your agents handle every reply.",
  },
  {
    value: TenantSettingsEngagementMode.copilot,
    label: "Co-Pilot",
    dot: "bg-amber-500",
    description:
      "The AI drafts a reply into the composer for your agent to review, edit, and send. It never sends on its own and never learns from these replies.",
  },
  {
    value: TenantSettingsEngagementMode.autopilot,
    label: "Auto-Pilot",
    dot: "bg-emerald-500",
    description:
      "The AI may send safe, high-confidence answers automatically and learn from them. Anything it isn't sure about hands back to your agent (no learning) until you step in.",
  },
];

/**
 * Self-contained "AI Engagement Mode" card. Owns its own tenant-settings read +
 * the engagement-mode PATCH so it can be dropped into any page (the new Account
 * Settings → "Haylo Ai" page, and — for now — the onboarding Security step).
 */
export default function EngagementModeCard() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery<EngagementSettings>({
    queryKey: ["tenant-settings/me"],
    queryFn: () => apiFetch<EngagementSettings>("/tenant-settings/me"),
  });

  const saveEngagementMode = useMutation({
    mutationFn: (mode: EngagementMode) =>
      apiFetch<EngagementSettings>("/tenant-settings/me", {
        method: "PATCH",
        body: JSON.stringify({ engagementMode: mode }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-settings/me"] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" />
          AI Engagement Mode
        </CardTitle>
        <CardDescription>
          Choose how the AI engages on inbound texts. Auto-Pilot is gated — it only sends on
          high-confidence answers grounded in your published knowledge, in safe topics, with no
          unresolved conflicts, and only when outbound compliance passes. You can override this
          per conversation from the inbox.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !settings ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="space-y-4 max-w-2xl">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {saveEngagementMode.isPending && (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                  Saving…
                </>
              )}
            </div>
            <RadioGroup
              value={settings.engagementMode}
              onValueChange={(v) => saveEngagementMode.mutate(v as EngagementMode)}
              disabled={saveEngagementMode.isPending}
              className="space-y-3"
              data-testid="engagement-mode-selector"
            >
              {ENGAGEMENT_MODE_OPTIONS.map((opt) => {
                const active = settings.engagementMode === opt.value;
                return (
                  <label
                    key={opt.value}
                    htmlFor={`engagement-mode-${opt.value}`}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                      active
                        ? "border-slate-900 bg-slate-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                    data-testid={`engagement-mode-option-${opt.value}`}
                  >
                    <RadioGroupItem
                      id={`engagement-mode-${opt.value}`}
                      value={opt.value}
                      className="mt-1"
                    />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${opt.dot}`}
                          aria-hidden
                        />
                        {opt.label}
                        {active && <Badge variant="outline">Active</Badge>}
                      </div>
                      <div className="text-xs text-slate-500">{opt.description}</div>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>

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
  );
}
