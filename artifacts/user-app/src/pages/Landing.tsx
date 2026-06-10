import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import {
  MessageSquare,
  Shield,
  Zap,
  Users,
  BarChart3,
  Bell,
  CheckCircle2,
  Sparkles,
  Building2,
  Lock,
} from "lucide-react";

export default function Landing() {
  const [, setLocation] = useLocation();
  const search = useSearch();

  // Backward-compat: legacy deep links to /?conversation=123 (from before
  // the marketing landing existed) should still open the inbox.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const cid = params.get("conversation");
    if (cid) {
      setLocation(`/inbox?conversation=${encodeURIComponent(cid)}`, { replace: true });
    }
  }, [search, setLocation]);

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">Textitie</span>
            <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
              Beta 1.01
            </span>
          </div>
          <nav className="flex items-center gap-2">
            <a
              href="#features"
              className="hidden md:inline text-sm text-slate-600 hover:text-slate-900 px-3 py-2"
            >
              Features
            </a>
            <a
              href="#who"
              className="hidden md:inline text-sm text-slate-600 hover:text-slate-900 px-3 py-2"
            >
              Who it's for
            </a>
            <a
              href="#compliance"
              className="hidden md:inline text-sm text-slate-600 hover:text-slate-900 px-3 py-2"
            >
              Compliance
            </a>
            <a
              href="#contact"
              className="hidden md:inline text-sm text-slate-600 hover:text-slate-900 px-3 py-2"
            >
              Contact
            </a>
            <Button
              variant="ghost"
              onClick={() => setLocation("/login")}
              data-testid="button-nav-login"
            >
              Login
            </Button>
            <Button
              onClick={() => setLocation("/signup")}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="button-nav-signup"
            >
              Sign Up
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-slate-900 leading-tight">
          Two-way SMS for teams<br />that actually answer.
        </h1>
        <p className="mt-6 text-xl text-slate-600 max-w-2xl mx-auto">
          Textitie is a shared text-message inbox for small and mid-sized
          businesses. Claim conversations, send compliant outbound campaigns,
          and let AI draft replies from your own knowledge base &mdash; all
          from one calm screen.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Button
            size="lg"
            onClick={() => setLocation("/signup")}
            className="bg-blue-600 hover:bg-blue-700 text-base px-6 py-6"
            data-testid="button-hero-signup"
          >
            Sign Up
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => setLocation("/login")}
            className="text-base px-6 py-6"
            data-testid="button-hero-login"
          >
            Login
          </Button>
        </div>
        <p className="mt-4 text-sm text-slate-500">
          No credit card required &middot; A2P 10DLC &amp; TCPA compliant
          &middot; HIPAA tier available
        </p>
      </section>

      {/* Features */}
      <section id="features" className="bg-slate-50 border-y border-slate-200 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900">
              Everything your team needs to text customers professionally.
            </h2>
            <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
              Built for the messy middle &mdash; teams too big for a personal
              phone, too small for a 50-seat call center.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={<MessageSquare className="w-6 h-6" />}
              title="Shared two-way inbox"
              body="One inbox for every text. See who claimed what, who's typing, and what's been said. Transfer, unassign, reopen, and audit with one click."
            />
            <FeatureCard
              icon={<Sparkles className="w-6 h-6" />}
              title="Halo AI Whisperer"
              body="Upload your PDFs, FAQs, and policy docs. Halo drafts contextual reply suggestions as private notes &mdash; agents review and send."
            />
            <FeatureCard
              icon={<Zap className="w-6 h-6" />}
              title="Campaigns &amp; automations"
              body="Bulk SMS campaigns with audience segmentation, variable injection, scheduling, and last-touch attribution. Plus keyword replies, auto-resolve, and welcome flows."
            />
            <FeatureCard
              icon={<Bell className="w-6 h-6" />}
              title="Reminders &amp; surveys"
              body="Never lose a follow-up. Set per-conversation reminders, and send one-tap CSAT surveys automatically after closure."
            />
            <FeatureCard
              icon={<BarChart3 className="w-6 h-6" />}
              title="Real analytics"
              body="Response times, open vs. closed, per-agent and per-department metrics, campaign attribution, CSAT scores &mdash; with CSV export."
            />
            <FeatureCard
              icon={<Users className="w-6 h-6" />}
              title="Multi-tenant from day one"
              body="Multiple locations, brands, or franchise units? Separate phone numbers, departments, agents, and branding per tenant under one control plane."
            />
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="who" className="py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900">
              Built for businesses that live on text.
            </h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <AudienceCard
              icon={<Building2 className="w-5 h-5" />}
              title="Local service businesses"
              body="HVAC, plumbing, auto repair, dental, vet clinics, salons, real estate teams."
            />
            <AudienceCard
              icon={<Shield className="w-5 h-5" />}
              title="Healthcare &amp; regulated"
              body="Clinics, mental health practices, and home health agencies needing HIPAA + BAA."
            />
            <AudienceCard
              icon={<Zap className="w-5 h-5" />}
              title="E-commerce &amp; sales"
              body="Shipping updates, abandoned carts, B2B outbound &mdash; with attribution that proves ROI."
            />
            <AudienceCard
              icon={<Users className="w-5 h-5" />}
              title="Franchises &amp; agencies"
              body="Multi-location chains and agencies managing dozens of client tenants from one Conductor."
            />
          </div>
        </div>
      </section>

      {/* Compliance */}
      <section id="compliance" className="bg-slate-900 text-slate-100 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Lock className="w-5 h-5 text-blue-400" />
                <span className="text-sm font-medium text-blue-400 uppercase tracking-wide">
                  Compliance built in
                </span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold">
                A2P 10DLC, TCPA, and HIPAA &mdash; handled.
              </h2>
              <p className="mt-4 text-lg text-slate-300">
                Carrier rules and TCPA penalties can shut down a business.
                Textitie bakes in the consent capture, opt-out handling, quiet
                hours, frequency caps, and double opt-in needed to keep your
                numbers approved and your team out of court.
              </p>
            </div>
            <ul className="space-y-3">
              <ComplianceItem>One-tap STOP / HELP keyword handling on every number</ComplianceItem>
              <ComplianceItem>Tenant-level quiet hours &amp; frequency caps</ComplianceItem>
              <ComplianceItem>Double opt-in workflows with audit trail</ComplianceItem>
              <ComplianceItem>10DLC Trust Hub status monitoring</ComplianceItem>
              <ComplianceItem>HIPAA tier with BAA acknowledgment &amp; PHI redaction</ComplianceItem>
              <ComplianceItem>Comprehensive audit log on every action</ComplianceItem>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-900">
            Stop missing texts. Start answering.
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Free trial. No credit card. Set up in under five minutes.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button
              size="lg"
              onClick={() => setLocation("/signup")}
              className="bg-blue-600 hover:bg-blue-700 text-base px-6 py-6"
              data-testid="button-cta-signup"
            >
              Sign Up
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setLocation("/login")}
              className="text-base px-6 py-6"
            >
              Login
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="contact" className="border-t border-slate-200 bg-slate-50 py-12">
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-slate-900">Textitie</span>
            </div>
            <p className="text-sm text-slate-600">
              Two-way SMS for teams that actually answer.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 mb-3">Product</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><a href="#features" className="hover:text-slate-900">Features</a></li>
              <li><a href="#who" className="hover:text-slate-900">Who it's for</a></li>
              <li><a href="#compliance" className="hover:text-slate-900">Compliance</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 mb-3">Account</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <button onClick={() => setLocation("/login")} className="hover:text-slate-900">
                  Login
                </button>
              </li>
              <li>
                <button onClick={() => setLocation("/signup")} className="hover:text-slate-900">
                  Start free trial
                </button>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 mb-3">Contact &amp; Legal</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <a href="mailto:info@textitie.com" className="hover:text-slate-900">
                  info@textitie.com
                </a>
              </li>
              <li>
                <button onClick={() => setLocation("/privacy")} className="hover:text-slate-900">
                  Privacy Policy
                </button>
              </li>
              <li>
                <button onClick={() => setLocation("/terms")} className="hover:text-slate-900">
                  Terms of Service
                </button>
              </li>
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 mt-10 pt-6 border-t border-slate-200 text-sm text-slate-500 flex flex-col md:flex-row items-center justify-between gap-3">
          <p>&copy; {new Date().getFullYear()} Textitie. All rights reserved.</p>
          <p>
            Message frequency varies. Msg &amp; data rates may apply. Reply HELP for help, STOP to cancel.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 hover:border-blue-300 hover:shadow-sm transition-all">
      <div className="w-11 h-11 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}

function AudienceCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="border border-slate-200 rounded-xl p-5">
      <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-900 mb-1" dangerouslySetInnerHTML={{ __html: title }} />
      <p className="text-sm text-slate-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}

function ComplianceItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <CheckCircle2 className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
      <span className="text-slate-200">{children}</span>
    </li>
  );
}
