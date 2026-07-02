import { useState } from "react";
import { Link } from "wouter";
import {
  Building2,
  PhoneCall,
  BadgeCheck,
  Check,
  type LucideIcon,
} from "lucide-react";
import {
  useListDepartments,
  useListPhoneNumbers,
} from "@workspace/api-client-react";
import {
  useIsPaidTier,
  UpgradeRequiredDialog,
} from "@/components/PaidTierGate";
import brainLogo from "@/assets/brain-logo.png";

type StepState = "complete" | "active" | "upcoming";

interface SetupStep {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  state: StepState;
}

/**
 * Inbox Hero Banner. Runs full-width along the very top of the Inbox (above the
 * conversation list + conversation pane). Brand-blue background (#3e6996) with
 * white text spanning BOTH columns, so whatever occupies the right-hand slot
 * keeps a consistent look & feel as messages rotate.
 *
 * Two-column layout — the branded strip is a PERMANENT fixture:
 *   - Left column: company branding (logo + wordmark). Always rendered; never
 *     retires. Spans to the conversation-list panel edge (w-80 / 320px), capped
 *     by a thin grey vertical divider.
 *   - Right column: a rotating "message slot". Its current occupant is the
 *     getting-started "Ready to start texting…" heading + bubble stepper, which
 *     shows ONLY while setup is incomplete and retires once the tenant has both
 *     a department and an assigned number. When empty, the blue strip + branding
 *     stay put, ready for the next message.
 *
 * Stepper bubbles track real tenant state (a department exists; a number is
 * assigned). The third "Register" bubble points to the (stubbed) registration
 * screen — registrationStatus isn't exposed to the tenant API, so it is not
 * tracked here.
 */
export default function InboxSetupBanner() {
  const {
    data: departments,
    isLoading: loadingDepts,
    isError: deptsError,
  } = useListDepartments();
  const {
    data: phoneNumbers,
    isLoading: loadingNumbers,
    isError: numbersError,
  } = useListPhoneNumbers();

  const hasDepartment = (departments?.length ?? 0) > 0;
  const hasNumber = (phoneNumbers?.length ?? 0) > 0;

  // Provisioning is a paid-tier feature: a free-trial tenant gets the demo
  // department + pool number auto-assigned at signup, so for them the stepper
  // is a permanent call-to-action whose clicks route through the upgrade
  // dialog (Price Packages) instead of the provisioning pages.
  const { isKnownUnpaid } = useIsPaidTier();
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // The branded strip is permanent; only the right-hand message slot changes.
  // The setup stepper is that slot's current occupant. Show it once we know
  // the real setup state (never flash a false "incomplete" while loading or
  // after a query error) and either:
  //   - setup is still incomplete (the original getting-started flow), or
  //   - the tenant is NOT on a paid tier — trial signups auto-receive a demo
  //     department + number, which used to retire the stepper instantly; now
  //     it stays up as the Dept → Phone → Register call-to-action, gated on
  //     upgrading.
  // A paid tenant with full setup retires the stepper as before, leaving the
  // slot ready for the next message.
  const settled =
    !loadingDepts && !loadingNumbers && !deptsError && !numbersError;
  const showSetupStepper =
    settled && (!(hasDepartment && hasNumber) || isKnownUnpaid);

  const steps: SetupStep[] = [
    {
      key: "department",
      label: "Department",
      href: "/onboarding/provision-department",
      icon: Building2,
      state: hasDepartment ? "complete" : "active",
    },
    {
      key: "number",
      label: "Phone Number",
      href: "/onboarding/departments",
      icon: PhoneCall,
      state: hasNumber ? "complete" : hasDepartment ? "active" : "upcoming",
    },
    {
      key: "register",
      label: "Register",
      href: "/settings?tab=phone-numbers",
      icon: BadgeCheck,
      state: hasDepartment && hasNumber ? "active" : "upcoming",
    },
  ];

  return (
    <div
      className="flex-shrink-0 bg-[#3e6996] px-6 py-2.5"
      data-testid="inbox-setup-banner"
    >
      <div className="flex items-stretch">
        {/* Column 1 — reserved for company branding. Ends at the conversation-
            list panel edge (w-80 / 320px) with a thin grey vertical divider. */}
        <div
          className="flex w-[296px] flex-shrink-0 items-center gap-3 border-r border-slate-300/50 pr-6"
          data-testid="banner-branding-column"
        >
          <img
            src={brainLogo}
            alt=""
            className="h-12 w-auto flex-shrink-0"
            aria-hidden
          />
          <div className="flex min-w-0 flex-col leading-none">
            <span className="text-2xl font-bold leading-[1.2]">
              <span className="text-white">Text</span>
              <span className="text-[#3febfa]">Itie</span>
            </span>
            <span className="mt-0.5 whitespace-nowrap text-xs font-normal tracking-[0.5px] text-[#e2e8f0]">
              Agentic AI Smart Messaging
            </span>
          </div>
        </div>

        {/* Column 2 — getting-started prompt + bubble stepper, left-aligned to
            match the conversation pane's avatar padding (header px-6). */}
        <div className="flex flex-1 items-center justify-start pl-6">
          {showSetupStepper && (
          <div className="flex flex-wrap items-center justify-start gap-x-8 gap-y-2">
            {/* Heading — mirrors Textline's getting-started prompt */}
            <p className="text-sm font-semibold text-white">
              Ready to start texting your customers?
            </p>

            {/* Bubble stepper */}
            <ol
              className="flex items-start"
              data-testid="setup-stepper"
              aria-label="Setup steps"
            >
              {steps.map((step, i) => {
                const Icon = step.icon;
                const prevComplete = i > 0 && steps[i - 1].state === "complete";
                const bubble = (
                  <>
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                        step.state === "complete"
                          ? "bg-white text-[#3e6996]"
                          : step.state === "active"
                            ? "bg-white text-[#3e6996] ring-2 ring-white/50"
                            : "border-2 border-white/60 bg-white/10 text-white group-hover:bg-white/20"
                      }`}
                    >
                      {step.state === "complete" ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span
                      className={`whitespace-nowrap text-[11px] leading-none ${
                        step.state === "upcoming"
                          ? "text-white/70"
                          : "font-medium text-white"
                      }`}
                    >
                      {step.label}
                    </span>
                  </>
                );
                return (
                  <li key={step.key} className="flex items-start">
                    {i > 0 && (
                      <span
                        className={`mt-[14px] h-0.5 w-6 sm:w-10 ${
                          prevComplete ? "bg-white" : "bg-white/30"
                        }`}
                        aria-hidden
                      />
                    )}
                    {isKnownUnpaid ? (
                      // Paid-tier gate: intercept the click and guide the
                      // tenant to Price Packages instead of the provisioning
                      // pages (the server enforces the same rule).
                      <button
                        type="button"
                        onClick={() => setUpgradeOpen(true)}
                        className="group flex flex-col items-center gap-1 px-1"
                        data-testid={`setup-step-${step.key}`}
                        aria-current={
                          step.state === "active" ? "step" : undefined
                        }
                      >
                        {bubble}
                      </button>
                    ) : (
                      <Link
                        href={step.href}
                        className="group flex flex-col items-center gap-1 px-1"
                        data-testid={`setup-step-${step.key}`}
                        aria-current={
                          step.state === "active" ? "step" : undefined
                        }
                      >
                        {bubble}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          )}
        </div>
      </div>
      <UpgradeRequiredDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </div>
  );
}
