import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Star } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface Survey {
  id: number;
  type: string;
  enabled: boolean;
  prompt: string;
  thankYou: string;
  sendAfterClose: boolean;
  sendDelayMinutes: number;
}

interface ResponseRow {
  id: number;
  score: number;
  comment: string | null;
  respondedAt: string;
  contactPhone: string;
  contactName: string | null;
  conversationId: number | null;
}

interface CsatStats {
  avg: number | null;
  count: number;
  sentCount: number;
  responseRate: number;
}

export default function SurveysSection() {
  const qc = useQueryClient();
  const { data: survey, isLoading } = useQuery<Survey>({
    queryKey: ["surveys"],
    queryFn: () => apiFetch<Survey>("/surveys"),
  });

  const { data: stats } = useQuery<CsatStats>({
    queryKey: ["analytics", "csat"],
    queryFn: () => apiFetch<CsatStats>("/analytics/csat"),
  });

  const { data: responses } = useQuery<{ items: ResponseRow[]; total: number }>({
    queryKey: ["surveys", "responses"],
    queryFn: () => apiFetch<{ items: ResponseRow[]; total: number }>("/surveys/responses?limit=20"),
  });

  const [enabled, setEnabled] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [thankYou, setThankYou] = useState("");
  const [sendAfterClose, setSendAfterClose] = useState(true);
  const [sendDelayMinutes, setSendDelayMinutes] = useState(0);

  useEffect(() => {
    if (survey) {
      setEnabled(survey.enabled);
      setPrompt(survey.prompt);
      setThankYou(survey.thankYou);
      setSendAfterClose(survey.sendAfterClose);
      setSendDelayMinutes(survey.sendDelayMinutes);
    }
  }, [survey]);

  const saveMutation = useMutation({
    mutationFn: (body: Partial<Survey>) =>
      apiFetch<Survey>("/surveys", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["surveys"] });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({ enabled, prompt, thankYou, sendAfterClose, sendDelayMinutes });
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Customer Satisfaction Surveys</h2>
        <p className="text-slate-500 text-sm">
          Send a one-tap CSAT (1–5) survey via SMS after closing a conversation.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Average CSAT (30d)</CardDescription>
            <CardTitle className="text-3xl flex items-center gap-2">
              {stats?.avg !== null && stats?.avg !== undefined ? (
                <>
                  {stats.avg.toFixed(2)}
                  <Star className="w-6 h-6 text-amber-500 fill-amber-500" />
                </>
              ) : (
                <span className="text-slate-300">—</span>
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Responses (30d)</CardDescription>
            <CardTitle className="text-3xl">{stats?.count ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Response Rate</CardDescription>
            <CardTitle className="text-3xl">
              {stats ? `${Math.round(stats.responseRate * 100)}%` : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500 pt-0">
            {stats?.count ?? 0} of {stats?.sentCount ?? 0} sent
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Survey Settings</CardTitle>
          <CardDescription>Configure how and when surveys are sent.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Surveys enabled</Label>
              <p className="text-xs text-slate-500">When off, no surveys are sent.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-survey-enabled" />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Auto-send when a conversation is closed</Label>
              <p className="text-xs text-slate-500">Automatically text the rating link after resolution.</p>
            </div>
            <Switch
              checked={sendAfterClose}
              onCheckedChange={setSendAfterClose}
              disabled={!enabled}
              data-testid="switch-survey-after-close"
            />
          </div>

          <div className="space-y-2">
            <Label>Send delay (minutes)</Label>
            <Input
              type="number"
              min={0}
              max={60}
              value={sendDelayMinutes}
              onChange={(e) => setSendDelayMinutes(Number(e.target.value) || 0)}
              disabled={!enabled}
              className="max-w-[140px]"
            />
            <p className="text-xs text-slate-500">0–60 minutes after close. Useful to give the agent time to undo.</p>
          </div>

          <div className="space-y-2">
            <Label>SMS prompt</Label>
            <textarea
              className="w-full min-h-[80px] rounded-md border border-slate-200 p-2 text-sm"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={300}
              disabled={!enabled}
            />
            <p className="text-xs text-slate-500">
              Sent as: <code className="text-slate-600">{prompt} https://yourapp/api/s/&lt;token&gt;</code>
            </p>
          </div>

          <div className="space-y-2">
            <Label>Thank-you page text</Label>
            <Input
              value={thankYou}
              onChange={(e) => setThankYou(e.target.value)}
              maxLength={200}
              disabled={!enabled}
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-survey">
              {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Responses</CardTitle>
          <CardDescription>Latest 20 customer ratings.</CardDescription>
        </CardHeader>
        <CardContent>
          {!responses || responses.items.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No responses yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="py-2 pr-4">Score</th>
                    <th className="py-2 pr-4">Contact</th>
                    <th className="py-2 pr-4">Comment</th>
                    <th className="py-2 pr-4">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {responses.items.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-4">
                        <Badge
                          className={
                            r.score >= 4
                              ? "bg-emerald-100 text-emerald-700"
                              : r.score >= 3
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                          }
                        >
                          {r.score} ★
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="font-medium">{r.contactName || r.contactPhone}</div>
                        {r.contactName && (
                          <div className="text-xs text-slate-400">{r.contactPhone}</div>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-slate-600 max-w-md truncate">
                        {r.comment || <span className="text-slate-300 italic">no comment</span>}
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(r.respondedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
