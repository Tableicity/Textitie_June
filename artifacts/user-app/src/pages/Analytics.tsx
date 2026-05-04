import { useState, useMemo } from "react";
import {
  useGetAnalyticsOverview,
  useGetAnalyticsVolume,
  useGetAnalyticsAgents,
  useGetAnalyticsDepartments,
  getGetAnalyticsOverviewQueryKey,
  getGetAnalyticsVolumeQueryKey,
  getGetAnalyticsAgentsQueryKey,
  getGetAnalyticsDepartmentsQueryKey,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import { format } from "date-fns";
import {
  MessageSquare,
  Clock,
  CheckCircle2,
  TrendingUp,
  Download,
  Loader2,
} from "lucide-react";
import { getTenantToken } from "@/lib/auth";

const RANGE_OPTIONS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

function fmtPercent(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function Analytics() {
  const [days, setDays] = useState(30);
  const [downloading, setDownloading] = useState(false);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [days]);

  const params = { from: range.from, to: range.to };

  const overview = useGetAnalyticsOverview(params, {
    query: { queryKey: getGetAnalyticsOverviewQueryKey(params) },
  });
  const volume = useGetAnalyticsVolume(params, {
    query: { queryKey: getGetAnalyticsVolumeQueryKey(params) },
  });
  const agents = useGetAnalyticsAgents(params, {
    query: { queryKey: getGetAnalyticsAgentsQueryKey(params) },
  });
  const departments = useGetAnalyticsDepartments(params, {
    query: { queryKey: getGetAnalyticsDepartmentsQueryKey(params) },
  });

  const handleExport = async () => {
    const token = getTenantToken();
    if (!token) return;
    setDownloading(true);
    try {
      const url = `${import.meta.env.BASE_URL}api/analytics/export?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const fromStr = range.from.slice(0, 10);
      const toStr = range.to.slice(0, 10);
      link.download = `conversations_${fromStr}_${toStr}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error(err);
      alert("CSV export failed. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const o = overview.data;
  const volumeData =
    volume.data?.map((p) => ({
      date: format(new Date(p.bucket), "MMM d"),
      conversations: p.newConversations,
      inbound: p.inboundMessages,
      outbound: p.outboundMessages,
    })) ?? [];

  return (
    <div className="h-full overflow-auto bg-slate-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Analytics & Insights</h1>
            <p className="text-sm text-slate-500 mt-1">
              {format(new Date(range.from), "MMM d, yyyy")} – {format(new Date(range.to), "MMM d, yyyy")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setDays(opt.days)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    days === opt.days
                      ? "bg-blue-600 text-white"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                  data-testid={`range-${opt.days}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleExport}
              disabled={downloading}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-60"
              data-testid="button-export-csv"
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export CSV
            </button>
          </div>
        </div>

        {overview.isLoading ? (
          <div className="text-center py-16 text-slate-500">Loading analytics…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                icon={MessageSquare}
                label="Conversations"
                value={String(o?.totalConversations ?? 0)}
                sub={`${o?.openConversations ?? 0} open · ${o?.closedConversations ?? 0} resolved`}
                accent="bg-blue-600"
              />
              <KpiCard
                icon={Clock}
                label="Avg first response"
                value={fmtDuration(o?.avgResponseSeconds ?? null)}
                sub={`Median ${fmtDuration(o?.medianResponseSeconds ?? null)} · p90 ${fmtDuration(o?.p90ResponseSeconds ?? null)}`}
                accent="bg-amber-500"
              />
              <KpiCard
                icon={CheckCircle2}
                label="Avg resolution"
                value={fmtDuration(o?.avgResolutionSeconds ?? null)}
                sub={`Resolution rate ${fmtPercent(o?.resolutionRate ?? null)}`}
                accent="bg-emerald-600"
              />
              <KpiCard
                icon={TrendingUp}
                label="Messages exchanged"
                value={String((o?.inboundMessages ?? 0) + (o?.outboundMessages ?? 0))}
                sub={`${o?.inboundMessages ?? 0} in · ${o?.outboundMessages ?? 0} out`}
                accent="bg-violet-600"
              />
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900 mb-4">Conversation volume</h2>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={volumeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#64748b" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#64748b" />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="conversations" stroke="#2563eb" strokeWidth={2} name="New conversations" />
                    <Line type="monotone" dataKey="inbound" stroke="#f59e0b" strokeWidth={2} name="Inbound msgs" />
                    <Line type="monotone" dataKey="outbound" stroke="#10b981" strokeWidth={2} name="Outbound msgs" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900 mb-4">Per-agent performance</h2>
                {agents.data && agents.data.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                          <th className="py-2 font-medium">Agent</th>
                          <th className="py-2 font-medium text-right">Convs</th>
                          <th className="py-2 font-medium text-right">Resolved</th>
                          <th className="py-2 font-medium text-right">Sent</th>
                          <th className="py-2 font-medium text-right">Avg TTFR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agents.data.map((a) => (
                          <tr key={a.agentId ?? a.agentName} className="border-b border-slate-100 last:border-0" data-testid={`row-agent-${a.agentId}`}>
                            <td className="py-2 text-slate-900">{a.agentName}</td>
                            <td className="py-2 text-right text-slate-700">{a.conversationsHandled}</td>
                            <td className="py-2 text-right text-slate-700">{a.resolvedCount}</td>
                            <td className="py-2 text-right text-slate-700">{a.messagesSent}</td>
                            <td className="py-2 text-right text-slate-700">{fmtDuration(a.avgResponseSeconds ?? null)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No agent activity in this range.</p>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900 mb-4">Per-department metrics</h2>
                {departments.data && departments.data.length > 0 ? (
                  <div style={{ width: "100%", height: 240 }}>
                    <ResponsiveContainer>
                      <BarChart data={departments.data.map((d) => ({
                        name: d.departmentName,
                        conversations: d.conversations,
                        resolved: d.resolvedCount,
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#64748b" />
                        <YAxis tick={{ fontSize: 12 }} stroke="#64748b" />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="conversations" fill="#2563eb" name="Conversations" />
                        <Bar dataKey="resolved" fill="#10b981" name="Resolved" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No department activity in this range.</p>
                )}
                {departments.data && departments.data.length > 0 && (
                  <div className="overflow-x-auto mt-4">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-200">
                          <th className="py-1.5 font-medium">Department</th>
                          <th className="py-1.5 font-medium text-right">Avg TTFR</th>
                          <th className="py-1.5 font-medium text-right">Avg resolution</th>
                        </tr>
                      </thead>
                      <tbody>
                        {departments.data.map((d) => (
                          <tr key={d.departmentId ?? d.departmentName} className="border-b border-slate-100 last:border-0">
                            <td className="py-1.5 text-slate-900">{d.departmentName}</td>
                            <td className="py-1.5 text-right text-slate-700">{fmtDuration(d.avgResponseSeconds ?? null)}</td>
                            <td className="py-1.5 text-right text-slate-700">{fmtDuration(d.avgResolutionSeconds ?? null)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
