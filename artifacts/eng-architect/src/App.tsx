import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/AppShell";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/Dashboard";
import Tenants from "@/pages/Tenants";
import TenantDetail from "@/pages/TenantDetail";
import Injections from "@/pages/Injections";
import Webhooks from "@/pages/Webhooks";
import Tiers from "@/pages/Tiers";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/tenants" component={Tenants} />
      <Route path="/tenants/:id" component={TenantDetail} />
      <Route path="/injections" component={Injections} />
      <Route path="/webhooks" component={Webhooks} />
      <Route path="/tiers" component={Tiers} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppShell>
            <Router />
          </AppShell>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
