import { useState, useEffect } from "react";
import { Link, useLocation, Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Settings, LogOut, CreditCard } from "lucide-react";
import {
  useTenantMe,
  useSetAgentStatus,
  useListAgents,
  getTenantMeQueryKey,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { removeTenantToken, getTenantToken } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";

type AgentStatus = "online" | "away" | "offline";

const STATUS_LABEL: Record<AgentStatus, string> = {
  online: "Online",
  away: "Away",
  offline: "Offline",
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  online: "bg-green-500",
  away: "bg-yellow-500",
  offline: "bg-slate-400",
};

const NEXT_STATUS: Record<AgentStatus, AgentStatus> = {
  online: "away",
  away: "offline",
  offline: "online",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const hasToken = !!getTenantToken();
  const { data, isLoading, isError } = useTenantMe({
    query: {
      enabled: hasToken,
      queryKey: getTenantMeQueryKey(),
      retry: false,
    },
  });

  const { data: agents } = useListAgents({
    query: {
      enabled: hasToken && !!data?.user,
      queryKey: getListAgentsQueryKey(),
    },
  });

  const myAgent = agents?.find((a) => a.id === data?.user?.id);
  const [status, setStatus] = useState<AgentStatus>("online");

  useEffect(() => {
    if (myAgent?.status) {
      const s = myAgent.status as AgentStatus;
      if (s === "online" || s === "away" || s === "offline") {
        setStatus(s);
      }
    }
  }, [myAgent?.status]);

  const setStatusMutation = useSetAgentStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      },
    },
  });

  const cycleStatus = () => {
    const next = NEXT_STATUS[status];
    setStatus(next);
    setStatusMutation.mutate({ data: { status: next } });
  };

  const handleLogout = () => {
    removeTenantToken();
    setLocation("/login");
  };

  if (!hasToken || isError) {
    return <Redirect to="/login" />;
  }

  if (isLoading || !data?.user) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <Skeleton className="h-12 w-12 rounded-full bg-slate-800" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-900 text-slate-300 overflow-hidden font-sans">
      {/* Sidebar Navigation */}
      <nav className="w-16 flex flex-col items-center py-4 border-r border-slate-800 bg-slate-900 z-20 flex-shrink-0">
        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center mb-8 shadow-sm">
          <MessageSquare className="w-5 h-5 text-white" />
        </div>

        <div className="flex flex-col gap-4 flex-1 w-full px-2">
          <Link
            href="/"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              location === "/"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Inbox"
          >
            <MessageSquare className="w-5 h-5" />
          </Link>

          <Link
            href="/settings"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              location === "/settings"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </Link>

          <Link
            href="/billing"
            className={`w-full aspect-square rounded-xl flex items-center justify-center transition-all ${
              location === "/billing"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
            title="Billing"
          >
            <CreditCard className="w-5 h-5" />
          </Link>
        </div>

        <div className="mt-auto w-full px-2 flex flex-col gap-2">
          <div className="relative w-full mb-2" title={data.user.name}>
            <div className="w-full aspect-square rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
              <span className="text-xs font-bold text-white uppercase">
                {data.user.name.substring(0, 2)}
              </span>
            </div>
            <button
              type="button"
              onClick={cycleStatus}
              disabled={setStatusMutation.isPending}
              title={`Status: ${STATUS_LABEL[status]} (click to change)`}
              className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-slate-900 ${STATUS_COLOR[status]} hover:scale-110 transition-transform disabled:opacity-60`}
            />
          </div>
          <button
            onClick={handleLogout}
            className="w-full aspect-square rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Log out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 bg-white text-slate-900 rounded-tl-2xl overflow-hidden shadow-2xl z-10 border-l border-t border-slate-200">
        {children}
      </main>
    </div>
  );
}
