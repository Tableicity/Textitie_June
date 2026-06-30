import { useState, useEffect, useCallback } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/AppShell";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import { initAuth, clearAuth } from "@/lib/auth";

import Dashboard from "@/pages/Dashboard";
import Tenants from "@/pages/Tenants";
import TenantDetail from "@/pages/TenantDetail";
import Professor from "@/pages/Professor";
import Brain from "@/pages/Brain";
import Injections from "@/pages/Injections";
import Webhooks from "@/pages/Webhooks";
import Compliance from "@/pages/Compliance";
import Telephony from "@/pages/Telephony";
import Tiers from "@/pages/Tiers";
import CreditPricing from "@/pages/CreditPricing";
import Profile from "@/pages/Profile";

let _logoutCallback: (() => void) | null = null;

function handleAuthError(error: unknown) {
  if (error && typeof error === "object" && "status" in error && (error as any).status === 401) {
    clearAuth();
    _logoutCallback?.();
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/tenants" component={Tenants} />
      <Route path="/tenants/:id/professor" component={Professor} />
      <Route path="/brain" component={Brain} />
      <Route path="/tenants/:id" component={TenantDetail} />
      <Route path="/injections" component={Injections} />
      <Route path="/webhooks" component={Webhooks} />
      <Route path="/compliance" component={Compliance} />
      <Route path="/telephony" component={Telephony} />
      <Route path="/tiers" component={Tiers} />
      <Route path="/credit-pricing" component={CreditPricing} />
      <Route path="/profile" component={Profile} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [authed, setAuthed] = useState(() => initAuth());

  const logout = useCallback(() => {
    setAuthed(false);
    queryClient.clear();
  }, []);

  useEffect(() => {
    _logoutCallback = logout;
    return () => { _logoutCallback = null; };
  }, [logout]);

  useEffect(() => {
    if (!authed) {
      setAuthed(initAuth());
    }
  }, []);

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

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
