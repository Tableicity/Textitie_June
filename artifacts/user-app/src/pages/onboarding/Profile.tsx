import { useState } from "react";
import {
  useChangeTenantPassword,
  useTenantMe,
  getTenantMeQueryKey,
} from "@workspace/api-client-react";
import { User, Mail, Shield, Building2, KeyRound, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "./components/SectionHeader";

const MIN_PASSWORD_LENGTH = 8;

export default function Profile() {
  const { toast } = useToast();
  const { data, isLoading } = useTenantMe({
    query: { queryKey: getTenantMeQueryKey(), retry: false },
  });
  const user = data?.user;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const changeMutation = useChangeTenantPassword({
    mutation: {
      onSuccess: () => {
        setCurrent("");
        setNext("");
        setConfirm("");
        toast({ title: "Password changed", description: "Your password has been updated." });
      },
      onError: (err: any) => {
        toast({
          title: "Change failed",
          description:
            err?.response?.data?.error ?? "Check your current password and try again.",
          variant: "destructive",
        });
      },
    },
  });

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    current.length > 0 &&
    next.length >= MIN_PASSWORD_LENGTH &&
    next === confirm &&
    !changeMutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    changeMutation.mutate({ data: { currentPassword: current, newPassword: next } });
  };

  return (
    <div>
      <SectionHeader title="Profile" subtitle="Your account details and password." />

      <div className="space-y-6">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="w-5 h-5 text-slate-500" />
              Account
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !user ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-5 w-64" />
                <Skeleton className="h-5 w-40" />
              </div>
            ) : (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  icon={<User className="w-4 h-4" />}
                  label="Name"
                  value={user.name}
                  testid="profile-name"
                />
                <Field
                  icon={<Mail className="w-4 h-4" />}
                  label="Email"
                  value={user.email}
                  testid="profile-email"
                />
                <Field
                  icon={<Shield className="w-4 h-4" />}
                  label="Role"
                  value={user.role}
                  testid="profile-role"
                />
                <Field
                  icon={<Building2 className="w-4 h-4" />}
                  label="Workspace"
                  value={user.tenantName}
                  testid="profile-tenant"
                />
              </dl>
            )}
          </CardContent>
        </Card>

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-slate-500" />
              Change password
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current-pw" className="text-xs uppercase tracking-wide text-slate-500">
                Current password
              </Label>
              <Input
                id="current-pw"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                data-testid="input-current-password"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-pw" className="text-xs uppercase tracking-wide text-slate-500">
                  New password
                </Label>
                <Input
                  id="new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  data-testid="input-new-password"
                />
                {tooShort && (
                  <p className="text-xs text-red-500">At least {MIN_PASSWORD_LENGTH} characters.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-pw" className="text-xs uppercase tracking-wide text-slate-500">
                  Confirm new password
                </Label>
                <Input
                  id="confirm-pw"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  data-testid="input-confirm-password"
                />
                {mismatch && <p className="text-xs text-red-500">Passwords don't match.</p>}
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button onClick={handleSubmit} disabled={!canSubmit} data-testid="button-change-password">
                {changeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Update password
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
  testid,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  testid: string;
}) {
  return (
    <div className="space-y-1">
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </dt>
      <dd className="text-sm font-medium text-slate-900" data-testid={testid}>
        {value}
      </dd>
    </div>
  );
}
