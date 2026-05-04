import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, Search } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface AuditLogItem {
  id: number;
  actorUserId: number | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  ip: string | null;
  createdAt: string;
}

interface AuditLogPage {
  items: AuditLogItem[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 25;

export default function AuditLogSection() {
  const [filters, setFilters] = useState({ entityType: "", action: "", entityId: "" });
  const [draft, setDraft] = useState({ entityType: "", action: "", entityId: "" });
  const [offset, setOffset] = useState(0);

  const queryString = (() => {
    const p = new URLSearchParams();
    if (filters.entityType) p.set("entityType", filters.entityType);
    if (filters.action) p.set("action", filters.action);
    if (filters.entityId) p.set("entityId", filters.entityId);
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(offset));
    return p.toString();
  })();

  const { data, isLoading } = useQuery<AuditLogPage>({
    queryKey: ["audit-logs", queryString],
    queryFn: () => apiFetch<AuditLogPage>(`/audit-logs?${queryString}`),
  });

  const apply = () => {
    setFilters(draft);
    setOffset(0);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="w-5 h-5" />
          Audit Log
        </CardTitle>
        <CardDescription>
          Tamper-evident record of who did what and when. Filter by entity, action, or ID.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
          <div>
            <Label className="text-xs text-slate-500 mb-1 block">Entity Type</Label>
            <Input
              placeholder="contact, conversation..."
              value={draft.entityType}
              onChange={(e) => setDraft((d) => ({ ...d, entityType: e.target.value }))}
              data-testid="audit-filter-entity-type"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500 mb-1 block">Action</Label>
            <Input
              placeholder="contact.updated..."
              value={draft.action}
              onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
              data-testid="audit-filter-action"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500 mb-1 block">Entity ID</Label>
            <Input
              placeholder="123"
              value={draft.entityId}
              onChange={(e) => setDraft((d) => ({ ...d, entityId: e.target.value }))}
              data-testid="audit-filter-entity-id"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={apply} className="w-full" data-testid="audit-apply-filters">
              <Search className="w-4 h-4 mr-2" />
              Apply
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">No audit log entries match your filters.</div>
        ) : (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Actor</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Entity</th>
                  <th className="px-3 py-2 text-left">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.items.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50" data-testid={`audit-row-${row.id}`}>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {row.actorEmail ?? (row.actorUserId ? `#${row.actorUserId}` : "system")}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        {row.action}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-600 font-mono text-xs">
                      {row.entityType}
                      {row.entityId ? `:${row.entityId}` : ""}
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{row.ip ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > PAGE_SIZE && (
          <div className="flex justify-between items-center mt-4 text-sm text-slate-500">
            <span>
              Showing {offset + 1}-{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
