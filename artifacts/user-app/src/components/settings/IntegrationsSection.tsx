import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plug, RefreshCw, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface IntegrationRow {
  id: number;
  provider: string;
  status: string;
  displayName: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface SyncQueueRow {
  id: number;
  entityType: string;
  entityId: string;
  op: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

interface SimLogRow {
  ts: string;
  op: string;
  entity: string;
  result: { id?: string; engagementId?: string; success?: boolean };
}

const HUBSPOT = "hubspot";

export default function IntegrationsSection() {
  const qc = useQueryClient();

  const { data: integrations, isLoading } = useQuery<IntegrationRow[]>({
    queryKey: ["integrations"],
    queryFn: () => apiFetch<IntegrationRow[]>("/integrations"),
  });

  const hubspot = integrations?.find((i) => i.provider === HUBSPOT);
  const isConnected = hubspot?.status === "connected";

  const { data: queue } = useQuery<SyncQueueRow[]>({
    queryKey: ["integrations", HUBSPOT, "sync-queue"],
    queryFn: () => apiFetch<SyncQueueRow[]>(`/integrations/${HUBSPOT}/sync-queue`),
    enabled: isConnected,
    refetchInterval: 5000,
  });

  const { data: simLog } = useQuery<SimLogRow[]>({
    queryKey: ["integrations", HUBSPOT, "sim-log"],
    queryFn: () => apiFetch<SimLogRow[]>(`/integrations/${HUBSPOT}/sim-log`),
    enabled: isConnected,
    refetchInterval: 5000,
  });

  const connect = useMutation({
    mutationFn: () =>
      apiFetch<IntegrationRow>(`/integrations/${HUBSPOT}/connect`, {
        method: "POST",
        body: JSON.stringify({ displayName: "HubSpot (Stub)" }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });

  const disconnect = useMutation({
    mutationFn: () =>
      apiFetch<IntegrationRow>(`/integrations/${HUBSPOT}/disconnect`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });

  const resync = useMutation({
    mutationFn: () =>
      apiFetch<{ enqueued: number }>(`/integrations/${HUBSPOT}/resync`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations", HUBSPOT, "sync-queue"] });
      qc.invalidateQueries({ queryKey: ["integrations", HUBSPOT, "sim-log"] });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="w-5 h-5" />
            HubSpot CRM
          </CardTitle>
          <CardDescription>
            Sync contacts and conversation activity into HubSpot. Currently running in <strong>stub
            mode</strong> — no real HubSpot calls are made; sync events are recorded in the
            simulation log below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="flex items-center justify-between max-w-2xl">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Status:</span>
                  {isConnected ? (
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Connected (stub)
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <XCircle className="w-3 h-3 mr-1" />
                      Not connected
                    </Badge>
                  )}
                </div>
                {hubspot?.connectedAt && (
                  <div className="text-xs text-slate-500">
                    Connected {new Date(hubspot.connectedAt).toLocaleString()}
                  </div>
                )}
                {hubspot?.lastError && (
                  <div className="text-xs text-red-600">Last error: {hubspot.lastError}</div>
                )}
              </div>
              <div className="flex gap-2">
                {isConnected ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => resync.mutate()}
                      disabled={resync.isPending}
                      data-testid="hubspot-resync"
                    >
                      {resync.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4 mr-2" />
                      )}
                      Resync now
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => disconnect.mutate()}
                      disabled={disconnect.isPending}
                      data-testid="hubspot-disconnect"
                    >
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => connect.mutate()}
                    disabled={connect.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                    data-testid="hubspot-connect"
                  >
                    {connect.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Connect HubSpot (Stub)
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>Sync Queue</CardTitle>
            <CardDescription>
              Recent items queued for HubSpot. Background worker processes them every minute with
              exponential backoff on failure.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(queue?.length ?? 0) === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">Queue empty.</div>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-[360px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">When</th>
                      <th className="px-3 py-2 text-left">Entity</th>
                      <th className="px-3 py-2 text-left">Op</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Attempts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {queue?.map((row) => (
                      <tr key={row.id} data-testid={`syncqueue-row-${row.id}`}>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {new Date(row.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {row.entityType}:{row.entityId}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline">{row.op}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          {row.status === "completed" && (
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                              completed
                            </Badge>
                          )}
                          {row.status === "pending" && <Badge variant="outline">pending</Badge>}
                          {row.status === "failed" && (
                            <Badge variant="destructive" title={row.lastError ?? ""}>
                              failed
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-xs">{row.attempts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>HubSpot Stub — Simulation Log</CardTitle>
            <CardDescription>
              Latest 100 simulated CRM operations. In a real connection these would be HubSpot API
              calls; here they are local entries.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(simLog?.length ?? 0) === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                No simulated operations yet. Create or update a contact to see activity.
              </div>
            ) : (
              <div className="font-mono text-xs space-y-1 max-h-[300px] overflow-y-auto bg-slate-50 p-3 rounded-md border border-slate-200">
                {simLog?.map((row, i) => (
                  <div key={i} className="text-slate-700">
                    <span className="text-slate-400">{new Date(row.ts).toLocaleTimeString()}</span>{" "}
                    <span className="text-blue-700">{row.op}</span> {row.entity}{" "}
                    <span className="text-slate-500">→ {JSON.stringify(row.result)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
