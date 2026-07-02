import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useSearch, Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Settings, LogOut, CreditCard, Zap, Megaphone, BarChart3, Users, PhoneCall, User, Lock, ArrowRight, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import HipaaBanner from "@/components/HipaaBanner";
import TrialBanner from "@/components/TrialBanner";
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
  useGetSubscription,
  getTenantMeQueryKey,
  getListAgentsQueryKey,
  getGetSubscriptionQueryKey,
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

// A single sidebar nav icon. When `locked` (an expired trial), it renders as a
// greyed, non-clickable icon instead of a navigable Link so an expired tenant
// can only reach Billing — the only way forward is to upgrade.
function NavIcon({
  href,
  title,
  active,
  locked,
  testId,
  children,
}: {
  href: string;
  title: string;
  active: boolean;
  locked: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  const base =
    "w-full aspect-square rounded-xl flex items-center justify-center transition-all";
  if (locked) {
    return (
      <div
        className={`${base} text-slate-600 opacity-40 cursor-not-allowed`}
        title={`${title} — upgrade to access`}
        aria-disabled="true"
        data-locked="true"
        data-testid={testId}
      >
        {children}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className={`${base} ${
        active
          ? "bg-blue-600 text-white shadow-md"
          : "text-slate-400 hover:text-white hover:bg-slate-800"
      }`}
      title={title}
      data-testid={testId}
    >
      {children}
    </Link>
  );
}

// One navigation destination, rendered by BOTH the desktop icon rail and the
// mobile drawer so the two can never drift apart.
type NavItemDef = {
  href: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  locked: boolean;
  testId?: string;
};

// Mobile-drawer variant of a nav entry — icon + label row inside the
// slide-out sheet. Mirrors NavIcon's locked/active behavior exactly.
function DrawerNavItem({
  href,
  title,
  icon: Icon,
  active,
  locked,
  testId,
  onNavigate,
}: {
  href: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  locked: boolean;
  testId?: string;
  onNavigate: () => void;
}) {
  if (locked) {
    return (
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-600 opacity-40 cursor-not-allowed"
        title={`${title} — upgrade to access`}
        aria-disabled="true"
        data-locked="true"
        data-testid={testId ? `drawer-${testId}` : undefined}
      >
        <Icon className="w-5 h-5" />
        {title}
      </div>
    );
  }
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
        active
          ? "bg-blue-600 text-white shadow-md"
          : "text-slate-300 hover:text-white hover:bg-slate-800"
      }`}
      data-testid={testId ? `drawer-${testId}` : undefined}
    >
      <Icon className="w-5 h-5" />
      {title}
    </Link>
  );
}

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

  // Trial expiry paywall. Once the trial-lifecycle job flips the tenant to
  // "expired", swap the main app for an upgrade wall — the demo number stays
  // assigned, but the workspace is blocked until they pay (server also
  // hard-stops every outbound send for expired tenants). /billing stays
  // reachable so an owner can actually upgrade. An operator billingBypass
  // override treats the tenant as paid and lifts the mask entirely.
  const {
    data: subscription,
    isLoading: isSubLoading,
    isError: isSubError,
  } = useGetSubscription({
    query: {
      enabled: hasToken && !!data?.user,
      queryKey: getGetSubscriptionQueryKey(),
    },
  });
  const isTrialExpired =
    subscription?.status === "expired" && !subscription?.billingBypass;

  // When the paywall is up, the real workspace stays mounted behind a frosted
  // "frozen" glass overlay so the tenant can see everything they'd regain by
  // upgrading. `inert` (set imperatively for cross-version support) pulls that
  // content out of tab order and blocks every click/focus — including the inset
  // gutter that peeks around the glass — so the lockdown stays airtight.
  const behindContentRef = useRef<HTMLDivElement>(null);
  const showTrialMask = isTrialExpired && location !== "/billing";

  useEffect(() => {
    const el = behindContentRef.current;
    if (!el) return;
    if (showTrialMask) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [showTrialMask]);

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

  // ── Mobile slide-out navigation drawer ───────────────────────────────────
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Safety net: close the drawer on any route change (each link also closes
  // it directly so same-path query-param navigations are covered too).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location]);

  // ── Profile dialog (A2P opt-in evidence) ─────────────────────────────────
  const { toast } = useToast();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState<LocalProfile>({ fullName: "", phone: "" });
  const userEmail = data?.user?.email ?? "";

  const openProfile = () => {
    // Expired tenants are locked to Billing only — don't open the profile dialog,
    // which otherwise renders as a modal over the paywall overlay.
    if (isTrialExpired) return;
    setProfileDraft(getLocalProfile(userEmail));
    setProfileOpen(true);
  };

  // If the trial expires while the profile dialog is already open, close it so a
  // lingering modal can't bypass the paywall.
  useEffect(() => {
    if (isTrialExpired) setProfileOpen(false);
  }, [isTrialExpired]);

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

  // Hold the workspace until the subscription state is known so an expired
  // tenant never flashes the app before the paywall mask mounts. /billing stays
  // reachable (that's where the owner upgrades); on a load error we fail OPEN to
  // avoid trapping the user — the server still hard-stops every outbound send.
  if (location !== "/billing" && isSubLoading && !subscription && !isSubError) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <Skeleton className="h-12 w-12 rounded-full bg-slate-800" />
      </div>
    );
  }

  // Single source of truth for navigation destinations — the desktop icon
  // rail and the mobile drawer both render from these lists.
  const mainNavItems: NavItemDef[] = [
    {
      href: "/inbox",
      title: "Messages",
      icon: MessageSquare,
      active: location === "/inbox" || location === "/",
      locked: isTrialExpired,
    },
    {
      href: "/analytics",
      title: "Analytics",
      icon: BarChart3,
      active: location === "/analytics",
      locked: isTrialExpired,
      testId: "link-analytics",
    },
    {
      href: "/automations",
      title: "Automations",
      icon: Zap,
      active: location === "/automations",
      locked: isTrialExpired,
    },
    {
      href: "/campaigns",
      title: "Campaigns",
      icon: Megaphone,
      active: location === "/campaigns",
      locked: isTrialExpired,
    },
    {
      href: "/billing",
      title: "Billing",
      icon: CreditCard,
      active: location === "/billing",
      locked: false,
      testId: "link-billing",
    },
    {
      href: "/settings",
      title: "Workspace Settings",
      icon: Settings,
      active: settingsActive,
      locked: isTrialExpired,
    },
    {
      href: "/settings?tab=phone-numbers",
      title: "Phone Numbers",
      icon: PhoneCall,
      active: phoneNumbersActive,
      locked: isTrialExpired,
      testId: "link-phone-numbers",
    },
  ];
  const secondaryNavItems: NavItemDef[] = [
    {
      href: "/onboarding",
      title: "Onboarding",
      icon: User,
      active: location.startsWith("/onboarding"),
      locked: isTrialExpired,
      testId: "link-onboarding",
    },
    {
      href: "/contacts",
      title: "Contacts",
      icon: Users,
      active: location === "/contacts",
      locked: isTrialExpired,
      testId: "link-contacts",
    },
  ];

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-900 text-slate-300 overflow-hidden font-sans">
      {/* Mobile top bar — hamburger opens the slide-out nav drawer. The icon
          rail below is desktop-only, so on phones this is the only chrome. */}
      <header className="md:hidden flex items-center gap-3 h-12 px-3 bg-slate-900 border-b border-slate-800 flex-shrink-0 z-20">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          title="Open menu"
          data-testid="button-mobile-nav"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="text-white font-semibold text-sm">Textitie</span>
      </header>

      {/* Sidebar Navigation (desktop only — phones use the drawer) */}
      <nav className="hidden md:flex w-16 flex-col items-center py-4 border-r border-slate-800 bg-slate-900 z-20 flex-shrink-0">
        <div className="flex flex-col gap-4 flex-1 w-full px-2">
          {mainNavItems.map((item) => (
            <NavIcon
              key={item.href}
              href={item.href}
              title={item.title}
              active={item.active}
              locked={item.locked}
              testId={item.testId}
            >
              <item.icon className="w-5 h-5" />
            </NavIcon>
          ))}
        </div>

        <div className="mt-auto w-full px-2 flex flex-col gap-2 items-center">
          {secondaryNavItems.map((item) => (
            <NavIcon
              key={item.href}
              href={item.href}
              title={item.title}
              active={item.active}
              locked={item.locked}
              testId={item.testId}
            >
              <item.icon className="w-5 h-5" />
            </NavIcon>
          ))}
          <div className="relative w-full mb-2">
            <button
              type="button"
              onClick={openProfile}
              disabled={isTrialExpired}
              title={
                isTrialExpired
                  ? "Profile — upgrade to access"
                  : `${data.user.name} — open profile`
              }
              data-testid="profile-avatar"
              className={`w-full aspect-square rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center transition-colors ${
                isTrialExpired
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:border-blue-400 hover:bg-slate-700"
              }`}
            >
              <span className="text-xs font-bold text-white uppercase">
                {data.user.name.substring(0, 2)}
              </span>
            </button>
            <button
              type="button"
              onClick={cycleStatus}
              disabled={setStatusMutation.isPending || isTrialExpired}
              title={`Status: ${STATUS_LABEL[status]} (click to change)`}
              className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-slate-900 ${STATUS_COLOR[status]} hover:scale-110 transition-transform disabled:opacity-60 disabled:hover:scale-100`}
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
      <main className="flex-1 min-h-0 bg-white text-slate-900 md:rounded-tl-2xl overflow-hidden shadow-2xl z-10 md:border-l md:border-t border-slate-200 flex flex-col">
        <TrialBanner
          status={subscription?.status}
          trialEndsAt={subscription?.trialEndsAt}
          billingBypass={subscription?.billingBypass}
          isOwner={data.user.role === "owner"}
        />
        <HipaaBanner />
        <div className="flex-1 overflow-hidden relative">
          {/* The real workspace stays mounted so it shows through the glass.
              While the paywall is up it's made `inert` (see effect) so nothing
              behind the overlay — including the inset gutter around the glass —
              is clickable or focusable. */}
          <div
            ref={behindContentRef}
            className="h-full w-full"
            aria-hidden={showTrialMask || undefined}
          >
            {children}
          </div>

          {showTrialMask && (
            <div
              className="absolute inset-x-0 bottom-0 top-[72px] z-30 flex items-center justify-center bg-slate-950/30"
              role="dialog"
              aria-labelledby="trial-expired-title"
              data-testid="trial-expired-overlay"
            >
              {/* Frosted "frozen vault" glass. The overlay starts ~72px down so the
                  full-width Inbox hero banner stays fully visible above it (still
                  non-interactive — the content behind is `inert`); the glass is then
                  inset (48px sides/bottom, small top gap) so the dimmed account
                  still peeks around it and it reads as an overlay floating over the
                  workspace rather than a full-bleed replacement. */}
              <div className="absolute inset-x-12 bottom-12 top-4 rounded-2xl bg-slate-900/55 backdrop-blur-md shadow-2xl ring-1 ring-white/10" />

              {/* Upgrade card stays fully opaque so the CTA keeps full contrast. */}
              <div className="relative max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-2xl p-8 text-center">
                <div className="mx-auto w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-5">
                  <Lock className="w-7 h-7 text-blue-600" />
                </div>
                <h1
                  id="trial-expired-title"
                  className="text-xl font-bold text-slate-900 mb-2"
                  data-testid="trial-expired-title"
                >
                  Your free trial has ended
                </h1>
                {data.user.role === "owner" ? (
                  <>
                    <p className="text-sm text-slate-600 mb-6">
                      Upgrade to a paid plan to keep texting. Your demo number, contacts,
                      and setup are saved — you'll pick up right where you left off.
                    </p>
                    <Button
                      onClick={() => setLocation("/billing")}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                      data-testid="button-upgrade-trial"
                    >
                      Upgrade to keep going
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-slate-600" data-testid="trial-expired-agent-note">
                    Your account owner needs to add a payment method to restore
                    texting. Your contacts and setup are saved — reach out to your
                    owner to upgrade.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Mobile navigation drawer — same destinations as the desktop rail */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-72 max-w-[85vw] bg-slate-900 border-slate-800 text-slate-300 p-0 flex flex-col"
        >
          <SheetHeader className="px-4 pt-4 pb-2 text-left">
            <SheetTitle className="text-white text-base">Textitie</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-1">
            {mainNavItems.map((item) => (
              <DrawerNavItem
                key={item.href}
                {...item}
                onNavigate={() => setMobileNavOpen(false)}
              />
            ))}
            <div className="my-2 border-t border-slate-800" />
            {secondaryNavItems.map((item) => (
              <DrawerNavItem
                key={item.href}
                {...item}
                onNavigate={() => setMobileNavOpen(false)}
              />
            ))}
          </div>
          <div className="border-t border-slate-800 p-3 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                openProfile();
              }}
              disabled={isTrialExpired}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="drawer-profile"
            >
              <span className="relative flex-shrink-0 w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
                <span className="text-xs font-bold text-white uppercase">
                  {data.user.name.substring(0, 2)}
                </span>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 ${STATUS_COLOR[status]}`}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-white truncate">{data.user.name}</span>
                <span className="block text-xs text-slate-500">{STATUS_LABEL[status]}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={cycleStatus}
              disabled={setStatusMutation.isPending || isTrialExpired}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="drawer-status"
            >
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ml-1 ${STATUS_COLOR[status]}`} />
              Status: {STATUS_LABEL[status]} — tap to change
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              data-testid="drawer-logout"
            >
              <LogOut className="w-5 h-5" />
              Log out
            </button>
          </div>
        </SheetContent>
      </Sheet>

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
