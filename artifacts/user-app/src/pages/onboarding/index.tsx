import { Switch, Route, Redirect } from "wouter";
import { useTenantMe, getTenantMeQueryKey } from "@workspace/api-client-react";
import { getTenantToken } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import OnboardingShell from "./OnboardingShell";
import Profile from "./Profile";
import Organization from "./Organization";
import Agents from "./Agents";
import Departments from "./Departments";
import Integrations from "./Integrations";
import Security from "./Security";
import BillingOverview from "./BillingOverview";
import PaymentBilling from "./PaymentBilling";
import Credits from "./Credits";
import Plans from "./Plans";

export default function OnboardingRoutes() {
  const hasToken = !!getTenantToken();
  const { data, isLoading, isError } = useTenantMe({
    query: {
      enabled: hasToken,
      queryKey: getTenantMeQueryKey(),
      retry: false,
    },
  });

  if (!hasToken || isError) {
    return <Redirect to="~/login" />;
  }

  if (isLoading || !data?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>
    );
  }

  return (
    <OnboardingShell>
      <Switch>
        <Route path="/">
          <Redirect to="/billing" />
        </Route>
        <Route path="/profile" component={Profile} />
        <Route path="/organization" component={Organization} />
        <Route path="/agents" component={Agents} />
        <Route path="/departments" component={Departments} />
        <Route path="/integrations" component={Integrations} />
        <Route path="/security" component={Security} />
        <Route path="/billing" component={BillingOverview} />
        <Route path="/billing/payments" component={PaymentBilling} />
        <Route path="/credits" component={Credits} />
        <Route path="/plans" component={Plans} />
        <Route component={NotFound} />
      </Switch>
    </OnboardingShell>
  );
}
