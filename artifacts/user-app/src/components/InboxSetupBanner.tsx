import { Link } from "wouter";
import {
  Building2,
  PhoneCall,
  BadgeCheck,
  Check,
  Info,
  type LucideIcon,
} from "lucide-react";
import {
  useListDepartments,
  useListPhoneNumbers,
} from "@workspace/api-client-react";

type StepState = "complete" | "active" | "upcoming";

interface SetupStep {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  state: StepState;
}

/**
 * Getting-started "bubble step" banner that sits ABOVE the Inbox conversation
 * header, mirroring Textline's department/phone-number setup prompt. Sized to
 * match the composer at the bottom of the same pane so the two strips balance.
 *
 * The first two bubbles track real tenant state (a department exists; a number
 * is assigned). Once both are present the tenant can text, so the banner
 * retires. The third "Register" bubble points to the (stubbed) registration
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

  // Don't flash the banner before we know the setup state, and don't show a
  // false "incomplete" state if a setup query fails.
  if (loadingDepts || loadingNumbers) return null;
  if (deptsError || numbersError) return null;

  const hasDepartment = (departments?.length ?? 0) > 0;
  const hasNumber = (phoneNumbers?.length ?? 0) > 0;

  // Functional "ready to text" gate: a department + an assigned number.
  if (hasDepartment && hasNumber) return null;

  const steps: SetupStep[] = [
    {
      key: "department",
      label: "Department",
      href: "/onboarding/departments",
      icon: Building2,
      state: hasDepartment ? "complete" : "active",
    },
    {
      key: "number",
      label: "Phone Number",
      href: "/settings?tab=phone-numbers",
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
      className="flex-shrink-0 border-b border-slate-200 bg-sky-50/60 px-6 py-4"
      data-testid="inbox-setup-banner"
    >
      <div className="flex min-h-[115px] flex-wrap items-center justify-between gap-x-6 gap-y-4">
        {/* Message — mirrors Textline's getting-started prompt */}
        <div className="flex max-w-sm items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600">
            <Info className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">
              Ready to start texting your customers?
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Create a department, add a phone number, and register it to get
              started.
            </p>
          </div>
        </div>

        {/* Bubble stepper */}
        <ol
          className="flex flex-1 items-start justify-end"
          data-testid="setup-stepper"
          aria-label="Setup steps"
        >
          {steps.map((step, i) => {
            const Icon = step.icon;
            const prevComplete = i > 0 && steps[i - 1].state === "complete";
            return (
              <li key={step.key} className="flex items-start">
                {i > 0 && (
                  <span
                    className={`mt-[18px] h-0.5 w-8 sm:w-12 ${
                      prevComplete ? "bg-blue-500" : "bg-slate-200"
                    }`}
                    aria-hidden
                  />
                )}
                <Link
                  href={step.href}
                  className="group flex flex-col items-center gap-1.5 px-1"
                  data-testid={`setup-step-${step.key}`}
                  aria-current={step.state === "active" ? "step" : undefined}
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                      step.state === "complete"
                        ? "bg-blue-600 text-white"
                        : step.state === "active"
                          ? "bg-blue-600 text-white ring-4 ring-blue-100"
                          : "border-2 border-slate-200 bg-white text-slate-400 group-hover:border-slate-300"
                    }`}
                  >
                    {step.state === "complete" ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </span>
                  <span
                    className={`whitespace-nowrap text-xs ${
                      step.state === "active"
                        ? "font-medium text-blue-700"
                        : step.state === "complete"
                          ? "text-slate-700"
                          : "text-slate-400"
                    }`}
                  >
                    {step.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
