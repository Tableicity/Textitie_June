import { Link, useLocation } from "wouter";
import { Activity, Webhook, Box, ShieldAlert, Zap, Users, ShieldCheck, UserCog, LogOut, BrainCircuit, Coins, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InjectComposerDialog } from "./InjectComposerDialog";
import { clearAuth } from "@/lib/auth";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();

  const links = [
    { href: "/", label: "Dashboard", icon: Activity },
    { href: "/tenants", label: "Tenants", icon: Users },
    { href: "/brain", label: "Brain", icon: BrainCircuit },
    { href: "/injections", label: "Injections", icon: Zap },
    { href: "/webhooks", label: "Webhooks", icon: Webhook },
    { href: "/compliance", label: "10DLC Compliance", icon: ShieldCheck },
    { href: "/telephony", label: "Telephony", icon: Phone },
    { href: "/tiers", label: "Tiers", icon: Box },
    { href: "/credit-pricing", label: "Credit Pricing", icon: Coins },
  ];

  const profileActive = location === "/profile";

  const handleLogout = () => {
    clearAuth();
    window.location.reload();
  };

  return (
    <div className="flex h-screen bg-background">
      <div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-8 w-8 bg-primary rounded flex items-center justify-center text-primary-foreground font-bold">
              S
            </div>
            <span className="font-bold text-sidebar-foreground tracking-widest">SAMA</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded">
            <ShieldAlert size={12} />
            <span>CONDUCTOR MODE</span>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {links.map((link) => {
            const active = location === link.href || (link.href !== "/" && location.startsWith(link.href));
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href} className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}>
                <Icon size={16} className={active ? "text-primary" : ""} />
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-2 border-t border-sidebar-border space-y-1">
          <Link href="/profile" className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
            profileActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          )}>
            <UserCog size={16} className={profileActive ? "text-primary" : ""} />
            User Management
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors w-full text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b flex items-center justify-between px-6 bg-card">
          <div className="text-sm text-muted-foreground font-mono">
            {location}
          </div>
          <InjectComposerDialog trigger={<Button size="sm" className="gap-2"><Zap size={14} /> Inject Message</Button>} />
        </header>
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
