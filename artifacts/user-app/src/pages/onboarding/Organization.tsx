import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useTenantMe,
  useGetTenantSettings,
  useUpdateTenantSettings,
  getTenantMeQueryKey,
  getGetTenantSettingsQueryKey,
} from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "./components/SectionHeader";

function ReadOnlyField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-slate-500">{label}</Label>
      <p className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
        {value || <span className="text-slate-400">—</span>}
      </p>
    </div>
  );
}

export default function Organization() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useTenantMe({ query: { queryKey: getTenantMeQueryKey() } });
  const role = me?.user?.role;
  const canEdit = role === "admin" || role === "owner";

  const settingsKey = getGetTenantSettingsQueryKey();
  const { data: tenant, isLoading } = useGetTenantSettings({
    query: { queryKey: settingsKey },
  });

  const [name, setName] = useState("");
  useEffect(() => {
    if (tenant?.name) setName(tenant.name);
  }, [tenant?.name]);

  const updateMutation = useUpdateTenantSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: settingsKey });
        queryClient.invalidateQueries({ queryKey: getTenantMeQueryKey() });
        toast({ title: "Organization updated", description: "Your changes have been saved." });
      },
      onError: (err: any) => {
        toast({
          title: "Update failed",
          description: err?.response?.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const dirty = tenant != null && name.trim().length > 0 && name.trim() !== tenant.name;

  const handleSave = () => {
    if (!canEdit || !dirty) return;
    updateMutation.mutate({ data: { name: name.trim() } });
  };

  return (
    <div>
      <SectionHeader
        title="Organization"
        subtitle="Your organization profile. Some identifiers are fixed for routing and compliance and can only be changed by support."
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading || !tenant ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="org-name" className="text-xs uppercase tracking-wide text-slate-500">
                  Organization name
                </Label>
                {canEdit ? (
                  <Input
                    id="org-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="input-org-name"
                  />
                ) : (
                  <p className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                    {tenant.name}
                  </p>
                )}
                {!canEdit && (
                  <p className="text-xs text-slate-500">
                    Only admins can change the organization name.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ReadOnlyField label="Workspace slug" value={tenant.slug} />
                <ReadOnlyField label="Region" value={tenant.region} />
                <ReadOnlyField label="Outbound number" value={tenant.phoneNumber} />
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-slate-500">Plan tier</Label>
                  <div>
                    <Badge variant="secondary" className="capitalize">{tenant.tierCode}</Badge>
                  </div>
                </div>
              </div>

              {canEdit && (
                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleSave}
                    disabled={!dirty || updateMutation.isPending}
                    data-testid="button-save-org"
                  >
                    {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Save changes
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
