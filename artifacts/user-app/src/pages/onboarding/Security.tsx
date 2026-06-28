import { useState } from "react";
import { useChangeTenantPassword } from "@workspace/api-client-react";
import { KeyRound, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ComplianceSection from "@/components/settings/ComplianceSection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "./components/SectionHeader";

const MIN_PASSWORD_LENGTH = 8;

export default function Security() {
  const { toast } = useToast();
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
        toast({ title: "Change failed", description: err?.response?.data?.error ?? "Check your current password and try again.", variant: "destructive" });
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
      <SectionHeader
        title="Security"
        subtitle="Manage your password and the compliance guardrails that protect your messaging."
      />

      <div className="space-y-6">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-slate-500" />
              Change password
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current-pw" className="text-xs uppercase tracking-wide text-slate-500">Current password</Label>
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
                <Label htmlFor="new-pw" className="text-xs uppercase tracking-wide text-slate-500">New password</Label>
                <Input
                  id="new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  data-testid="input-new-password"
                />
                {tooShort && <p className="text-xs text-red-500">At least {MIN_PASSWORD_LENGTH} characters.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-pw" className="text-xs uppercase tracking-wide text-slate-500">Confirm new password</Label>
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

        <ComplianceSection showEngagementMode />
      </div>
    </div>
  );
}
