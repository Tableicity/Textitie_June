import { useState, useEffect } from "react";
import { Link, useLocation, useSearch, Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Settings, LogOut, CreditCard, Zap, Megaphone, BarChart3, Users, PhoneCall, User } from "lucide-react";
import HipaaBanner from "@/components/HipaaBanner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  getLocalProfile,
  setLocalProfile,
  clearLocalProfile,
  clearLastEmail,
  formatUSPhone,
  type LocalProfile,
} from "@/lib/profile";
import {
  useTenantMe,
  useSetAgentStatus,
  useListAgents,
  getTenantMeQueryKey,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { removeTenantToken, getTenantToken } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";

type AgentStatus = "online" | "away" | "offline";

const STATUS_LABEL: Record<AgentStatus, string> = {
  online: "Online",
  away: "Away",
  offline: "Offline",
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  online: "bg-green-500",
  away: "bg-yellow-500",
  offline: "bg-slate-400",
};

const NEXT_STATUS: Record<AgentStatus, AgentStatus> = {
  online: "away",
  away: "offline",
  offline: "online",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const phoneNumbersActive =
    location === "/settings" && new URLSearchParams(search).get("tab") === "phone-numbers";
  const settingsActive = location === "/settings" && !phoneNumbersActive;
  const queryClient = useQueryClient();
  const hasToken = !!getTenantToken();
  const { data, isLoading, isError } = useTenantMe({
    query: {
      enabled: hasToken,
      queryKey: getTenantMeQueryKey(),
      retry: false,
    },
  });

  const { data: agents } = useListAgents({
    query: {
      enabled: hasToken && !!data?.user,
      queryKey: getListAgentsQueryKey(),
    },
  });

  const myAgent = agents?.find((a) => a.id === data?.user?.id);
  const [status, setStatus] = useState<AgentStatus>("online");

  useEffect(() => {
    if (myAgent?.status) {
      const s = myAgent.status as AgentStatus;
      if (s === "online" || s === "away" || s === "offline") {
        setStatus(s);
      }
    }
  }, [myAgent?.status]);

  const setStatusMutation = useSetAgentStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      },
    },
  });

  const cycleStatus = () => {
    const next = NEXT_STATUS[status];
    setStatus(next);
    setStatusMutation.mutate({ data: { status: next } });
  };

  const handleLogout = () => {
    // Forget the "last email" hint so the Login form starts neutral on a
    // shared device. Per-email profiles remain stored, scoped by their email.
    clearLastEmail();
    removeTenantToken();
    setLocation("/login");
  };

  // ── Profile dialog (A2P opt-in evidence) ─────────────────────────────────
  const { toast } = useToast();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState<LocalProfile>({ fullName: "", phone: "" });
  const userEmail = data?.user?.email ?? "";

  const openProfile = () => {
    setProfileDraft(getLocalProfile(userEmail));
    setProfileOpen(true);
  };

  const saveProfile = () => {
    if (profileDraft.fullName.trim().length < 2) {
      toast({ title: "Full name required", description: "Enter at least 2 characters.", variant: "destructive" });
      return;
    }
    if (profileDraft.phone.replace(/\D/g, "").length !== 10) {
      toast({ title: "Phone required", description: "Enter a valid 10-digit US number.", variant: "destructive" });
      return;
    }
    setLocalProfile(userEmail, profileDraft);
    setProfileOpen(false);
    toast({ title: "Profile saved", description: "Will prefill on next sign-in." });
  };

  const removeProfile = () => {
    clearLocalProfile(userEmail);
    setProfileDraft({ fullName: "", phone: "" });
    toast({ title: "Profile cleared", description: "Sign-in form will start blank." });
  };

  if (!hasToken || isError) {
    return <Redirect to="/login" />;
  }

  if (isLoading || !data?.user) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <Skeleton className="h-12 w-12 rounded-full bg-slate-800" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-900 text-slate-300 overflow-hidden font-sans">
      {/* Sidebar Navigation */}
      <nav className="w-16 flex flex-col items-center py-4 border-r border-slate-800 bg-slate-900 z-20 flex-shrink-0">
        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center mb-8 shadow-sm">
          <MessageSquare className="w-5 h-5 text-white" />
        </div>

        <div className="flex flex-col gap-4 flex-1 w-full px-2">
          <Link
            href="/inbox"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              location === "/inbox" || location === "/"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Messages"
          >
            <MessageSquare className="w-5 h-5" />
          </Link>

          <Link
            href="/analytics"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              location === "/analytics"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Analytics"
            data-testid="link-analytics"
          >
            <BarChart3 className="w-5 h-5" />
          </Link>

          <Link
            href="/automations"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              location === "/automations"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Automations"
          >
            <Zap className="w-5 h-5" />
          </Link>

          <Link
            href="/campaigns"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              location === "/campaigns"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Campaigns"
          >
            <Megaphone className="w-5 h-5" />
          </Link>

          <Link
            href="/billing"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              location === "/billing"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Billing"
          >
            <CreditCard className="w-5 h-5" />
          </Link>

          <Link
            href="/settings"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              settingsActive
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Workspace Settings"
          >
            <Settings className="w-5 h-5" />
          </Link>

          <Link
            href="/settings?tab=phone-numbers"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              phoneNumbersActive
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Phone Numbers"
            data-testid="link-phone-numbers"
          >
            <PhoneCall className="w-5 h-5" />
          </Link>
        </div>

        <div className="mt-auto w-full px-2 flex flex-col gap-2 items-center">
          <Link
            href="/profile"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              location === "/profile"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Profile"
            data-testid="link-profile"
          >
            <User className="w-5 h-5" />
          </Link>
          <Link
            href="/contacts"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              location === "/contacts"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Contacts"
            data-testid="link-contacts"
          >
            <Users className="w-5 h-5" />
          </Link>
          <div className="relative w-full mb-2">
            <button
              type="button"
              onClick={openProfile}
              title={`${data.user.name} — open profile`}
              data-testid="profile-avatar"
              className="w-full aspect-square rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center hover:border-blue-400 hover:bg-slate-700 transition-colors"
            >
              <span className="text-xs font-bold text-white uppercase">
                {data.user.name.substring(0, 2)}
              </span>
            </button>
            <button
              type="button"
              onClick={cycleStatus}
              disabled={setStatusMutation.isPending}
              title={`Status: ${STATUS_LABEL[status]} (click to change)`}
              className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-slate-900 ${STATUS_COLOR[status]} hover:scale-110 transition-transform disabled:opacity-60`}
            />
          </div>
          <button
            onClick={handleLogout}
            className="w-full aspect-square rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Log out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 bg-white text-slate-900 rounded-tl-2xl overflow-hidden shadow-2xl z-10 border-l border-t border-slate-200 flex flex-col">
        <HipaaBanner />
        <div className="flex-1 overflow-hidden">{children}</div>
      </main>

      {/* Profile dialog — manages locally-stored A2P opt-in evidence */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your profile</DialogTitle>
            <DialogDescription>
              Used to pre-fill the sign-in form. Stored only in this browser
              for SMS opt-in records — not sent to our servers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="profile-fullname" className="text-xs">Full Name</Label>
              <Input
                id="profile-fullname"
                placeholder="Jane Doe"
                autoComplete="name"
                value={profileDraft.fullName}
                onChange={(e) => setProfileDraft((p) => ({ ...p, fullName: e.target.value }))}
                data-testid="profile-full-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-phone" className="text-xs">Phone</Label>
              <Input
                id="profile-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="(555) 123-4567"
                maxLength={14}
                value={profileDraft.phone}
                onChange={(e) =>
                  setProfileDraft((p) => ({ ...p, phone: formatUSPhone(e.target.value) }))
                }
                data-testid="profile-phone"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Signed in as</Label>
              <p className="text-sm text-slate-700">{data.user.name}</p>
              <p className="text-xs text-slate-500">{data.user.email}</p>
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={removeProfile}
              data-testid="profile-clear"
            >
              Clear saved profile
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setProfileOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={saveProfile} data-testid="profile-save">
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
