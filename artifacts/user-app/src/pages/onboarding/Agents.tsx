import { Link } from "wouter";
import { useListAgents } from "@workspace/api-client-react";
import { Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "./components/SectionHeader";

const STATUS_COLOR: Record<string, string> = {
  online: "bg-green-500",
  away: "bg-yellow-500",
  offline: "bg-slate-400",
};

export default function Agents() {
  const { data: agents, isLoading } = useListAgents();

  return (
    <div>
      <SectionHeader
        title="Agent Settings"
        subtitle="The people on your account. Statuses, skills, and routing are managed in your workspace settings."
        action={
          <Link
            href="~/settings"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            data-testid="link-manage-team"
          >
            Manage team →
          </Link>
        }
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !agents || agents.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">No agents yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {agents.map((agent) => (
                <div key={agent.id} className="flex items-center justify-between px-6 py-4" data-testid={`agent-row-${agent.id}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 uppercase">
                        {agent.name.substring(0, 2)}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${STATUS_COLOR[agent.status] ?? "bg-slate-400"}`}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{agent.name}</p>
                      <p className="text-xs text-slate-400 truncate">{agent.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {agent.departments.length > 0 && (
                      <span className="hidden sm:inline text-xs text-slate-400">
                        {agent.departments.length} dept{agent.departments.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    <Badge variant="outline" className="capitalize">{agent.role}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
