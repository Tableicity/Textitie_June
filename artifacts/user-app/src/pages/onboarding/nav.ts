export interface OnboardingNavItem {
  label: string;
  href: string;
}

export interface OnboardingNavGroup {
  label?: string;
  items: OnboardingNavItem[];
}

// Mirrors the Textline "Account Settings" left-pane: a flat settings group on
// top, then an expanded "Plans & Billing" group. Hrefs are relative to the
// `/onboarding` nested router.
export const ONBOARDING_NAV: OnboardingNavGroup[] = [
  {
    items: [
      { label: "Organization", href: "/organization" },
      { label: "Agent Settings", href: "/agents" },
      { label: "Departments", href: "/departments" },
      { label: "Tools & Integrations", href: "/integrations" },
      { label: "Security", href: "/security" },
    ],
  },
  {
    label: "Plans & Billing",
    items: [
      { label: "Overview", href: "/billing" },
      { label: "Payment & Billing", href: "/billing/payments" },
      { label: "Message credits", href: "/credits" },
      { label: "Change Plan", href: "/plans" },
    ],
  },
];
