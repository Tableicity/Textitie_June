import { useState } from "react";
import { Link, useLocation } from "wouter";
import { MessageSquare, ArrowLeft } from "lucide-react";
import {
  useIsPaidTier,
  UpgradeRequiredDialog,
} from "@/components/PaidTierGate";
import { ONBOARDING_NAV } from "./nav";

export default function OnboardingShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { isKnownUnpaid } = useIsPaidTier();
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      {/* Header — Textitie brand, light theme */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-30">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="~/inbox" className="flex items-center gap-2">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">Textitie</span>
          </Link>
          <Link
            href="~/inbox"
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 font-medium"
            data-testid="link-back-to-inbox"
          >
            <ArrowLeft className="w-4 h-4" /> Back to inbox
          </Link>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-8 flex gap-8 items-start">
        {/* Left nav — "Account Settings" */}
        <aside className="w-60 flex-shrink-0">
          <nav className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm sticky top-24">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-3">
              Account Settings
            </p>
            <div className="space-y-4">
              {ONBOARDING_NAV.map((group, gi) => (
                <div key={gi}>
                  {group.label && (
                    <p className="text-xs font-semibold text-blue-600 px-2 mb-1.5">{group.label}</p>
                  )}
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = location === item.href;
                      const className = `block w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                        group.label ? "pl-3" : ""
                      } ${
                        active
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      }`;
                      const testId = `nav-${item.href.replace(/\//g, "-").replace(/^-/, "")}`;
                      // Paid-tier gate: provisioning entries alert an unpaid
                      // tenant and guide them to Price Packages instead of
                      // navigating.
                      if (item.paidOnly && isKnownUnpaid) {
                        return (
                          <button
                            key={item.href}
                            type="button"
                            onClick={() => setUpgradeOpen(true)}
                            data-testid={testId}
                            className={className}
                          >
                            {item.label}
                          </button>
                        );
                      }
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          data-testid={testId}
                          className={className}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
      <UpgradeRequiredDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </div>
  );
}
