import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Login from "@/pages/Login";
import Inbox from "@/pages/Inbox";
import Settings from "@/pages/Settings";
import Billing from "@/pages/Billing";
import Automations from "@/pages/Automations";
import Campaigns from "@/pages/Campaigns";
import AppShell from "@/components/AppShell";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route>
        <AppShell>
          <Switch>
            <Route path="/" component={Inbox} />
            <Route path="/settings" component={Settings} />
            <Route path="/billing" component={Billing} />
            <Route path="/automations" component={Automations} />
            <Route path="/campaigns" component={Campaigns} />
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
