import { useState, useEffect, useMemo } from "react";
import {
  useListCampaigns,
  useCreateCampaign,
  useDeleteCampaign,
  useSendCampaign,
  useGetCampaignCredits,
  usePreviewAudience,
  useGetCampaign,
  useListCampaignMessages,
  getListCampaignsQueryKey,
  getGetCampaignCreditsQueryKey,
  getGetCampaignQueryKey,
  getListCampaignMessagesQueryKey,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Megaphone,
  Plus,
  Trash2,
  Send,
  ChevronRight,
  ChevronLeft,
  Users,
  CreditCard,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Loader2,
  ArrowLeft,
  Coins,
  Calendar,
  MessageSquare,
  Ban,
} from "lucide-react";

type WizardStep = "audience" | "compose" | "review";
type ViewMode = "list" | "create" | "detail";

const GSM7_CHARS = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "ÄÖÑÜabcdefghijklmnopqrstuvwxyzäöñüà§"
);
const GSM7_EXTENDED = new Set("|^€{}[]~\\");

function calcSegments(text: string) {
  if (!text) return { chars: 0, segments: 0, encoding: "GSM-7" as const, limit: 160 };
  let isGsm = true;
  for (const ch of text) {
    if (!GSM7_CHARS.has(ch) && !GSM7_EXTENDED.has(ch)) { isGsm = false; break; }
  }
  if (isGsm) {
    let len = 0;
    for (const ch of text) len += GSM7_EXTENDED.has(ch) ? 2 : 1;
    if (len <= 160) return { chars: len, segments: 1, encoding: "GSM-7" as const, limit: 160 };
    return { chars: len, segments: Math.ceil(len / 153), encoding: "GSM-7" as const, limit: 153 };
  }
  const len = text.length;
  if (len <= 70) return { chars: len, segments: 1, encoding: "UCS-2" as const, limit: 70 };
  return { chars: len, segments: Math.ceil(len / 67), encoding: "UCS-2" as const, limit: 67 };
}

function StatusBadge({ status, scheduledAt }: { status: string; scheduledAt?: string | null }) {
  const isScheduled = status === "draft" && scheduledAt && new Date(scheduledAt).getTime() > Date.now();
  if (isScheduled) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        <Calendar className="w-3 h-3" />
        scheduled
      </span>
    );
  }
  const colors: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700",
    sending: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    paused: "bg-yellow-100 text-yellow-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

function CreditBalanceCard() {
  const { data: credits, isLoading } = useGetCampaignCredits({
    query: { queryKey: getGetCampaignCreditsQueryKey() },
  });
  const [, navigate] = useLocation();

  if (isLoading || !credits) return null;

  const isUnlimited = credits.totalAvailable === -1;

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-xl border border-indigo-200 p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
          <Coins className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <p className="text-sm text-slate-500">Available Credits</p>
          <p className="text-xl font-bold text-slate-900">
            {isUnlimited ? "Unlimited" : credits.totalAvailable.toLocaleString()}
          </p>
          {!isUnlimited && (
            <p className="text-xs text-slate-500">
              {credits.prepaidCredits.toLocaleString()} prepaid + {credits.includedRemaining === -1 ? "∞" : credits.includedRemaining.toLocaleString()} included
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {credits.overageEnabled && (
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">Overage ON</span>
        )}
        <button
          onClick={() => navigate("/onboarding/credits")}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          + Top Up
        </button>
      </div>
    </div>
  );
}

function CampaignListView({ onCreateNew, onViewDetail }: { onCreateNew: () => void; onViewDetail: (id: number) => void }) {
  const { data: campaigns, isLoading } = useListCampaigns({
    query: { queryKey: getListCampaignsQueryKey() },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteMutation = useDeleteCampaign({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        toast({ title: "Campaign deleted" });
      },
    },
  });

  return (
    <div className="space-y-4">
      <CreditBalanceCard />
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Campaigns</h2>
        <button
          onClick={onCreateNew}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Campaign
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : !campaigns || campaigns.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-xl border border-slate-200">
          <Megaphone className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No campaigns yet</p>
          <p className="text-slate-400 text-xs mt-1">Create your first bulk messaging campaign</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div
              key={c.id}
              onClick={() => onViewDetail(c.id)}
              className="bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm cursor-pointer transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <h3 className="font-medium text-slate-900">{c.name}</h3>
                  <StatusBadge status={c.status} scheduledAt={c.scheduledAt} />
                </div>
                <div className="flex items-center gap-2">
                  {c.status === "draft" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate({ id: c.id }); }}
                      className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
              <p className="text-sm text-slate-500 line-clamp-1 mb-2">{c.body}</p>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {c.totalRecipients} recipients</span>
                <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> {c.creditsRequired} credits</span>
                {c.status === "completed" && (
                  <>
                    <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="w-3 h-3" /> {c.sentCount} sent</span>
                    {c.failedCount > 0 && (
                      <span className="flex items-center gap-1 text-red-500"><XCircle className="w-3 h-3" /> {c.failedCount} failed</span>
                    )}
                  </>
                )}
                {c.status === "sending" && (
                  <span className="flex items-center gap-1 text-blue-600"><Loader2 className="w-3 h-3 animate-spin" /> Sending...</span>
                )}
                <span>{new Date(c.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateCampaignWizard({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: number) => void }) {
  const [step, setStep] = useState<WizardStep>("audience");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [customTag, setCustomTag] = useState("");
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [scheduledAtLocal, setScheduledAtLocal] = useState<string>(() => {
    // Default to 1 hour from now in datetime-local format
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const segmentFilter = useMemo(() => {
    const f: any = {};
    if (selectedTags.length > 0) f.tags = selectedTags;
    if (filterStatus) f.status = filterStatus;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [selectedTags, filterStatus]);

  const preview = usePreviewAudience({
    mutation: {},
  });

  useEffect(() => {
    preview.mutate({ data: { segmentFilter } });
  }, [selectedTags, filterStatus]);

  const segInfo = calcSegments(body);
  const recipientCount = preview.data?.count ?? 0;
  const creditsRequired = recipientCount * Math.max(1, segInfo.segments);

  const { data: credits } = useGetCampaignCredits({
    query: { queryKey: getGetCampaignCreditsQueryKey() },
  });

  const createMutation = useCreateCampaign({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        onCreated(data.id);
      },
      onError: () => {
        toast({ title: "Failed to create campaign", variant: "destructive" });
      },
    },
  });

  const availableCredits = credits ? (credits.totalAvailable === -1 ? Infinity : credits.totalAvailable) : 0;
  const overageEnabled = credits?.overageEnabled ?? false;
  const canAfford = creditsRequired <= availableCredits || overageEnabled;

  const PRESET_TAGS = ["vip", "support", "sales", "prospect", "orders", "enterprise", "resolved"];

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (t && !selectedTags.includes(t)) setSelectedTags([...selectedTags, t]);
  };
  const removeTag = (tag: string) => setSelectedTags(selectedTags.filter((t) => t !== tag));

  const insertVariable = (varName: string) => {
    setBody((prev) => prev + `{{${varName}}}`);
  };

  const handleCreate = () => {
    if (!name.trim() || !body.trim()) {
      toast({ title: "Name and message body are required", variant: "destructive" });
      return;
    }
    let scheduledAtIso: string | undefined;
    if (sendMode === "later") {
      const parsed = new Date(scheduledAtLocal);
      if (Number.isNaN(parsed.getTime())) {
        toast({ title: "Pick a valid date and time", variant: "destructive" });
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        toast({ title: "Scheduled time must be in the future", variant: "destructive" });
        return;
      }
      scheduledAtIso = parsed.toISOString();
    }
    createMutation.mutate({
      data: {
        name: name.trim(),
        body: body.trim(),
        segmentFilter,
        ...(scheduledAtIso ? { scheduledAt: scheduledAtIso } : {}),
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h2 className="text-lg font-semibold text-slate-900">Create Campaign</h2>
      </div>

      <div className="flex items-center gap-2 mb-6">
        {(["audience", "compose", "review"] as WizardStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => setStep(s)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                step === s ? "bg-indigo-100 text-indigo-700" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                step === s ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-500"
              }`}>
                {i + 1}
              </span>
              {s === "audience" ? "Audience" : s === "compose" ? "Compose" : "Review & Send"}
            </button>
            {i < 2 && <ChevronRight className="w-4 h-4 text-slate-300" />}
          </div>
        ))}
      </div>

      {step === "audience" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Campaign Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Holiday Sale Announcement"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Filter by Tags</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {PRESET_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => selectedTags.includes(tag) ? removeTag(tag) : addTag(tag)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    selectedTags.includes(tag)
                      ? "bg-indigo-100 text-indigo-700 border-indigo-300"
                      : "bg-white text-slate-600 border-slate-300 hover:border-indigo-300"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { addTag(customTag); setCustomTag(""); } }}
                placeholder="Add custom tag..."
                className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={() => { addTag(customTag); setCustomTag(""); }}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200 transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Filter by Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                <span className="text-sm font-medium text-slate-700">Audience Preview</span>
              </div>
              <span className="text-2xl font-bold text-indigo-600">
                {preview.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : recipientCount}
              </span>
            </div>
            {preview.data && preview.data.contacts.length > 0 && (
              <div className="mt-3 space-y-1">
                {preview.data.contacts.slice(0, 5).map((c) => (
                  <div key={c.id} className="text-xs text-slate-500 flex items-center gap-2">
                    <span className="font-medium">{c.contactName || "Unknown"}</span>
                    <span className="text-slate-400">{c.contactPhone}</span>
                  </div>
                ))}
                {preview.data.count > 5 && (
                  <p className="text-xs text-slate-400">+ {preview.data.count - 5} more</p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setStep("compose")}
              disabled={!name.trim() || recipientCount === 0}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
            >
              Next: Compose <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {step === "compose" && (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-slate-700">Message Body</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Variables:</span>
                {["first_name", "full_name", "phone"].map((v) => (
                  <button
                    key={v}
                    onClick={() => insertVariable(v)}
                    className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded border border-indigo-200 hover:bg-indigo-100 transition-colors font-mono"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hi {{first_name}}, we have an exciting offer for you..."
              rows={5}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-none"
            />
          </div>

          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-xs text-slate-500">Characters</p>
                <p className="text-lg font-bold text-slate-900">{segInfo.chars}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Segments</p>
                <p className={`text-lg font-bold ${segInfo.segments > 1 ? "text-amber-600" : "text-slate-900"}`}>
                  {segInfo.segments}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Encoding</p>
                <p className={`text-lg font-bold ${segInfo.encoding === "UCS-2" ? "text-amber-600" : "text-slate-900"}`}>
                  {segInfo.encoding}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Credits Required</p>
                <p className="text-lg font-bold text-indigo-600">{creditsRequired}</p>
              </div>
            </div>
            {segInfo.encoding === "UCS-2" && (
              <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Emoji or special characters detected — using UCS-2 encoding (70 chars/segment instead of 160)
              </p>
            )}
          </div>

          <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
            <p className="text-xs font-medium text-blue-700 mb-1">Preview (first recipient)</p>
            <p className="text-sm text-blue-900 font-mono whitespace-pre-wrap">
              {body.replace(/\{\{first_name\}\}/g, preview.data?.contacts?.[0]?.contactName?.split(" ")[0] ?? "there")
                   .replace(/\{\{full_name\}\}/g, preview.data?.contacts?.[0]?.contactName ?? "there")
                   .replace(/\{\{phone\}\}/g, preview.data?.contacts?.[0]?.contactPhone ?? "+1...")}
            </p>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep("audience")}
              className="px-4 py-2 text-slate-600 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 transition-colors inline-flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={() => setStep("review")}
              disabled={!body.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
            >
              Next: Review <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-slate-900 text-lg">{name}</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Recipients</p>
                <p className="text-xl font-bold text-slate-900">{recipientCount}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Credits Required</p>
                <p className="text-xl font-bold text-indigo-600">{creditsRequired}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Available Credits</p>
                <p className="text-xl font-bold text-slate-900">
                  {availableCredits === Infinity ? "Unlimited" : availableCredits.toLocaleString()}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Segments per Msg</p>
                <p className="text-xl font-bold text-slate-900">{Math.max(1, segInfo.segments)}</p>
              </div>
            </div>

            {selectedTags.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Tag Filters</p>
                <div className="flex flex-wrap gap-1">
                  {selectedTags.map((t) => (
                    <span key={t} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs">{t}</span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> When to Send
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSendMode("now")}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors text-left ${
                    sendMode === "now"
                      ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                      : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    <span>Send now</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">Create as draft, send manually</p>
                </button>
                <button
                  type="button"
                  onClick={() => setSendMode("later")}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors text-left ${
                    sendMode === "later"
                      ? "bg-amber-50 border-amber-300 text-amber-700"
                      : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    <span>Schedule for later</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">Auto-fire at the chosen time</p>
                </button>
              </div>
              {sendMode === "later" && (
                <div className="mt-3">
                  <input
                    type="datetime-local"
                    value={scheduledAtLocal}
                    onChange={(e) => setScheduledAtLocal(e.target.value)}
                    className="w-full px-3 py-2 border border-amber-300 bg-amber-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <p className="text-xs text-amber-700 mt-1">
                    The scheduler runs every minute, so the campaign may fire up to ~60s after the chosen time.
                  </p>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-1">Message</p>
              <div className="bg-slate-50 rounded-lg p-3 text-sm font-mono whitespace-pre-wrap text-slate-700">{body}</div>
            </div>

            {!canAfford && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">Insufficient Credits</p>
                  <p className="text-xs text-red-600 mt-1">
                    You need {creditsRequired.toLocaleString()} credits but only have {typeof availableCredits === "number" ? availableCredits.toLocaleString() : "0"} available.
                    Top up or enable overage billing to proceed.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep("compose")}
              className="px-4 py-2 text-slate-600 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 transition-colors inline-flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending || !canAfford}
              className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : sendMode === "later" ? <Calendar className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              {sendMode === "later" ? "Schedule Campaign" : "Create & Review"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignDetailView({ campaignId, onBack }: { campaignId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: campaign, isLoading } = useGetCampaign(campaignId, {
    query: {
      queryKey: getGetCampaignQueryKey(campaignId),
      refetchInterval: (query) => {
        const data = query.state.data;
        return data && data.status === "sending" ? 2000 : false;
      },
    },
  });

  const { data: messages } = useListCampaignMessages(campaignId, {
    query: {
      queryKey: getListCampaignMessagesQueryKey(campaignId),
      enabled: !!campaign && campaign.status !== "draft",
      refetchInterval: campaign?.status === "sending" ? 2000 : false,
    },
  });

  const sendMutation = useSendCampaign({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaignId) });
        queryClient.invalidateQueries({ queryKey: getListCampaignMessagesQueryKey(campaignId) });
        queryClient.invalidateQueries({ queryKey: getGetCampaignCreditsQueryKey() });
        toast({ title: "Campaign sending started!" });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error || "Failed to send campaign";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  if (isLoading || !campaign) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const total = campaign.totalRecipients || 1;
  const sentPct = Math.round(((campaign.sentCount ?? 0) / total) * 100);
  const failedPct = Math.round(((campaign.failedCount ?? 0) / total) * 100);
  const deliveryRate = campaign.sentCount ? Math.round(((campaign.sentCount - (campaign.failedCount ?? 0)) / campaign.sentCount) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-900">{campaign.name}</h2>
            <StatusBadge status={campaign.status} scheduledAt={campaign.scheduledAt} />
          </div>
          <p className="text-xs text-slate-400">
            Created {new Date(campaign.createdAt).toLocaleString()}
            {campaign.scheduledAt && campaign.status === "draft" && (
              <span className="ml-2 text-amber-600 font-medium">
                · Auto-fires {new Date(campaign.scheduledAt).toLocaleString()}
              </span>
            )}
          </p>
        </div>
        {campaign.status === "draft" && (
          <button
            onClick={() => sendMutation.mutate({ id: campaignId })}
            disabled={sendMutation.isPending}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
          >
            {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {campaign.scheduledAt ? "Send Now Instead" : "Send Now"}
          </button>
        )}
      </div>

      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-sm font-mono whitespace-pre-wrap text-slate-700">
        {campaign.body}
      </div>

      {(campaign.status === "sending" || campaign.status === "completed" || campaign.status === "failed") && (
        <>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Delivery Progress</h3>
            <div className="w-full bg-slate-200 rounded-full h-3 mb-2 overflow-hidden">
              <div className="h-full flex">
                <div className="bg-green-500 transition-all duration-500" style={{ width: `${sentPct}%` }} />
                <div className="bg-red-500 transition-all duration-500" style={{ width: `${failedPct}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 mt-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-slate-900">{campaign.totalRecipients}</p>
                <p className="text-xs text-slate-500">Total</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{campaign.sentCount ?? 0}</p>
                <p className="text-xs text-slate-500">Sent</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-red-500">{campaign.failedCount ?? 0}</p>
                <p className="text-xs text-slate-500">Failed</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-indigo-600">{deliveryRate}%</p>
                <p className="text-xs text-slate-500">Delivery Rate</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Engagement & Attribution</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-50 rounded-lg p-3 text-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
                <p className="text-2xl font-bold text-emerald-700">{campaign.deliveredCount ?? 0}</p>
                <p className="text-xs text-emerald-600">Delivered</p>
                <p className="text-[10px] text-slate-400 mt-0.5">via carrier callback</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <MessageSquare className="w-4 h-4 text-blue-600 mx-auto mb-1" />
                <p className="text-2xl font-bold text-blue-700">{campaign.responseCount ?? 0}</p>
                <p className="text-xs text-blue-600">Responses</p>
                <p className="text-[10px] text-slate-400 mt-0.5">last-touch within 72h</p>
              </div>
              <div className="bg-rose-50 rounded-lg p-3 text-center">
                <Ban className="w-4 h-4 text-rose-600 mx-auto mb-1" />
                <p className="text-2xl font-bold text-rose-700">{campaign.optOutCount ?? 0}</p>
                <p className="text-xs text-rose-600">Opt-Outs</p>
                <p className="text-[10px] text-slate-400 mt-0.5">attributed to this campaign</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Recipient Messages</h3>
              <button
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: getListCampaignMessagesQueryKey(campaignId) });
                }}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            {messages && messages.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {messages.map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        m.status === "sent" || m.status === "delivered" ? "bg-green-500" :
                        m.status === "failed" ? "bg-red-500" :
                        m.status === "sending" ? "bg-blue-500" : "bg-slate-300"
                      }`} />
                      <div>
                        <p className="text-sm font-medium text-slate-700">{m.contactName || m.contactPhone}</p>
                        <p className="text-xs text-slate-400">{m.contactPhone}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-medium ${
                        m.status === "sent" || m.status === "delivered" ? "text-green-600" :
                        m.status === "failed" ? "text-red-500" :
                        m.status === "sending" ? "text-blue-600" : "text-slate-400"
                      }`}>
                        {m.status}
                      </span>
                      {m.errorMessage && <p className="text-xs text-red-400">{m.errorMessage}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-4">No messages yet</p>
            )}
          </div>
        </>
      )}

      {campaign.status === "draft" && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <p className="text-xs text-slate-500">Recipients</p>
            <p className="text-xl font-bold text-slate-900">{campaign.totalRecipients}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <p className="text-xs text-slate-500">Credits Required</p>
            <p className="text-xl font-bold text-indigo-600">{campaign.creditsRequired}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <p className="text-xs text-slate-500">Status</p>
            <p className="text-xl font-bold text-slate-900">Ready</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Campaigns() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <Megaphone className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Campaigns</h1>
            <p className="text-sm text-slate-500">Bulk messaging with audience segmentation and credit management</p>
          </div>
        </div>

        {viewMode === "list" && (
          <CampaignListView
            onCreateNew={() => setViewMode("create")}
            onViewDetail={(id) => { setSelectedCampaignId(id); setViewMode("detail"); }}
          />
        )}

        {viewMode === "create" && (
          <CreateCampaignWizard
            onCancel={() => setViewMode("list")}
            onCreated={(id) => { setSelectedCampaignId(id); setViewMode("detail"); }}
          />
        )}

        {viewMode === "detail" && selectedCampaignId && (
          <CampaignDetailView
            campaignId={selectedCampaignId}
            onBack={() => { setSelectedCampaignId(null); setViewMode("list"); }}
          />
        )}
      </div>
    </div>
  );
}
