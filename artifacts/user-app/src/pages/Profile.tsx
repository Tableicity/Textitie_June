import { useState } from "react";
import { useChangeTenantPassword, useTenantMe, getTenantMeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Mail, Shield, Building2 } from "lucide-react";

export default function Profile() {
  const { toast } = useToast();
  const { data, isLoading } = useTenantMe({
    query: { queryKey: getTenantMeQueryKey(), retry: false },
  });
  const user = data?.user;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const changePassword = useChangeTenantPassword({
    mutation: {
      onSuccess: () => {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        toast({ title: "Password updated", description: "Your password has been changed." });
      },
      onError: (err) => {
        const data = (err as { data?: { error?: unknown } } | null)?.data;
        const message =
          data && typeof data.error === "string"
            ? data.error
            : "Could not update password. Please try again.";
        toast({ title: "Update failed", description: message, variant: "destructive" });
      },
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({
        title: "Password too short",
        description: "New password must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "New password and confirmation must match.",
        variant: "destructive",
      });
      return;
    }
    changePassword.mutate({ data: { currentPassword, newPassword } });
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
          <p className="text-sm text-slate-500">Your account details and password.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Signed-in user information.</CardDescription>
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
                <Field icon={<User className="w-4 h-4" />} label="Name" value={user.name} testid="profile-name" />
                <Field icon={<Mail className="w-4 h-4" />} label="Email" value={user.email} testid="profile-email" />
                <Field icon={<Shield className="w-4 h-4" />} label="Role" value={user.role} testid="profile-role" />
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

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Use at least 8 characters.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  data-testid="input-current-password"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  data-testid="input-new-password"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  data-testid="input-confirm-password"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={changePassword.isPending}
                data-testid="button-change-password"
              >
                {changePassword.isPending ? "Updating…" : "Update password"}
              </Button>
            </form>
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
