import { useGetStats, useListInjections, useListWebhookEvents } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Zap, Webhook, Activity } from "lucide-react";
import { StatusBadge, SourceBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetStats();
  const { data: injections, isLoading: injectionsLoading } = useListInjections({ limit: 5 });
  const { data: webhooks, isLoading: webhooksLoading } = useListWebhookEvents({ limit: 5 });

  if (statsLoading || injectionsLoading || webhooksLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-2">Control Plane Telemetry & Stats</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tenants</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.tenantCount || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Injections</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.injectionCount || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Webhook Events</CardTitle>
            <Webhook className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.webhookEventCount || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Injections (24h)</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.injectionsLast24h || 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Recent Injections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {injections?.length === 0 && <div className="text-sm text-muted-foreground">No recent injections</div>}
              {injections?.map((inj) => (
                <div key={inj.id} className="flex items-center justify-between p-3 border rounded-lg bg-card">
                  <div className="flex flex-col gap-1 overflow-hidden">
                    <div className="text-sm font-mono truncate">{inj.toNumber}</div>
                    <div className="text-xs text-muted-foreground truncate">{inj.body}</div>
                  </div>
                  <div className="ml-4 shrink-0">
                    <StatusBadge status={inj.status} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Webhooks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {webhooks?.length === 0 && <div className="text-sm text-muted-foreground">No recent webhooks</div>}
              {webhooks?.map((wh) => (
                <div key={wh.id} className="flex items-center justify-between p-3 border rounded-lg bg-card">
                  <div className="flex flex-col gap-1 overflow-hidden">
                    <div className="text-sm font-medium"><SourceBadge source={wh.source} /></div>
                    <div className="text-xs text-muted-foreground truncate font-mono">
                      {new Date(wh.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Tenants by Region</CardTitle>
          </CardHeader>
          <CardContent>
             <div className="space-y-2">
                {stats?.tenantsByRegion.map(tr => (
                   <div key={tr.region} className="flex justify-between border-b pb-2 last:border-0 last:pb-0">
                      <Badge variant="outline">{tr.region}</Badge>
                      <span className="font-medium">{tr.count}</span>
                   </div>
                ))}
             </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tenants by Tier</CardTitle>
          </CardHeader>
          <CardContent>
             <div className="space-y-2">
                {stats?.tenantsByTier.map(tt => (
                   <div key={tt.tierCode} className="flex justify-between border-b pb-2 last:border-0 last:pb-0">
                      <Badge variant="secondary" className="capitalize">{tt.tierCode}</Badge>
                      <span className="font-medium">{tt.count}</span>
                   </div>
                ))}
             </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
