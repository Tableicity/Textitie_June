import { Link, useLocation, Redirect } from "wouter";
import { MessageSquare, Settings, LogOut } from "lucide-react";
import { useTenantMe, getTenantMeQueryKey } from "@workspace/api-client-react";
import { removeTenantToken, getTenantToken } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const hasToken = !!getTenantToken();
  const { data, isLoading, isError } = useTenantMe({
    query: {
      enabled: hasToken,
      queryKey: getTenantMeQueryKey(),
      retry: false,
    }
  });

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
        </div>

        <div className="mt-auto w-full px-2 flex flex-col gap-2">
          <div className="w-full aspect-square rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mb-2" title={data.user.name}>
            <span className="text-xs font-bold text-white uppercase">{data.user.name.substring(0, 2)}</span>
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