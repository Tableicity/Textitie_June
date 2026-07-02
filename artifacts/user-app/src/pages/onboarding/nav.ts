export interface OnboardingNavItem {
  label: string;
  href: string;
  /**
   * Provisioning entries are paid-tier features: an unpaid (free-trial)
   * tenant's click opens the upgrade dialog guiding to Price Packages
   * instead of navigating (the target pages and the server enforce the
   * same rule).
   */
  paidOnly?: boolean;
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
      { label: "Profile", href: "/profile" },
      { label: "Organization", href: "/organization" },
      { label: "Agent Settings", href: "/agents" },
      { label: "+ Provision Number", href: "/departments", paidOnly: true },
      {
        label: "+ Provision Department",
        href: "/provision-department",
        paidOnly: true,
      },
      { label: "Tools & Integrations", href: "/integrations" },
      { label: "Security", href: "/security" },
      { label: "Haylo Ai", href: "/haylo-ai" },
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
