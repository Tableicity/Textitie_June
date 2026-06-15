import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Verify from "@/pages/Verify";
import Signup from "@/pages/Signup";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import Inbox from "@/pages/Inbox";
import Contacts from "@/pages/Contacts";
import Settings from "@/pages/Settings";
import Billing from "@/pages/Billing";
import Automations from "@/pages/Automations";
import Campaigns from "@/pages/Campaigns";
import Analytics from "@/pages/Analytics";
import Knowledge from "@/pages/Knowledge";
import Profile from "@/pages/Profile";
import OnboardingRoutes from "@/pages/onboarding";
import AppShell from "@/components/AppShell";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/verify" component={Verify} />
      <Route path="/signup" component={Signup} />
      <Route path="/signup/trial" component={Signup} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/onboarding" nest>
        <OnboardingRoutes />
      </Route>
      <Route>
        <AppShell>
          <Switch>
            <Route path="/inbox" component={Inbox} />
            <Route path="/contacts" component={Contacts} />
            <Route path="/settings" component={Settings} />
            <Route path="/billing" component={Billing} />
            <Route path="/automations" component={Automations} />
            <Route path="/campaigns" component={Campaigns} />
            <Route path="/analytics" component={Analytics} />
            <Route path="/knowledge" component={Knowledge} />
            <Route path="/profile" component={Profile} />
            <Route component={NotFound} />
          </Switch>
        </AppShell>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
