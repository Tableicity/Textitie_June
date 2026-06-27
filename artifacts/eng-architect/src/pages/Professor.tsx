import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTenant,
  getGetTenantQueryKey,
  useListProfessorSessions,
  getListProfessorSessionsQueryKey,
  useCreateProfessorSession,
  useArchiveProfessorSession,
  useReopenProfessorSession,
  useListProfessorMessages,
  getListProfessorMessagesQueryKey,
  useListAbsorbedFacts,
  getListAbsorbedFactsQueryKey,
  useUpdateAbsorbedFactStatus,
  useUpdateAbsorbedFactCategory,
  useGetCurrentClassroom,
  getGetCurrentClassroomQueryKey,
  usePushToClassroom,
  useAbsorbProfessorAnswer,
  type AbsorbedFactCategoryInputCategory,
  useAddLibraryUrl,
  useAddLibraryText,
} from "@workspace/api-client-react";
import { getStoredAuthHeader } from "@/lib/auth";
import { AutoLearnedReviewPanel } from "@/components/AutoLearnedReviewPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  GraduationCap,
  Plus,
  Sparkles,
  Globe,
  Radio,
  Save,
  Upload,
  Send,
  Briefcase,
  User,
  Check,
  AlertTriangle,
  X,
  Loader2,
  Link2,
  ClipboardPaste,
  Archive,
  Lock,
  RotateCcw,
} from "lucide-react";

const MEMORY_BUDGET = 10_000_000;
const MAX_ACTIVE_SESSIONS = 5;

// Routing categories the Student uses as a "fast switch". Kept in sync with the
// server taxonomy in artifacts/api-server/src/lib/knowledge.ts.
const FACT_CATEGORIES = [
  "pricing",
  "compliance",
  "features",
  "technical_setup",
  "general",
] as const;
const CATEGORY_LABELS: Record<string, string> = {
  pricing: "Pricing",
  compliance: "Compliance",
  features: "Features",
  technical_setup: "Setup",
  general: "General",
};
const CATEGORY_CLASSES: Record<string, string> = {
  pricing: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  compliance: "bg-rose-500/15 text-rose-600 border-rose-500/30",
  features: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  technical_setup: "bg-violet-500/15 text-violet-600 border-violet-500/30",
  general: "bg-muted text-muted-foreground border-border",
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function formatBudget(n: number): string {
  return `${n.toLocaleString()} / 10.0M`;
}

export default function Professor() {
  const params = useParams();
  const tenantId = params.id ? parseInt(params.id, 10) : 0;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: tenant } = useGetTenant(tenantId, {
    query: { enabled: !!tenantId, queryKey: getGetTenantQueryKey(tenantId) },
  });

  const { data: sessions } = useListProfessorSessions(tenantId, {
    query: {
      enabled: !!tenantId,
      queryKey: getListProfessorSessionsQueryKey(tenantId),
    },
  });

  const allSessions = useMemo(() => sessions ?? [], [sessions]);
  const activeSessions = useMemo(
    () => allSessions.filter((s) => s.status === "active"),
    [allSessions],
  );
  // Prior sessions the Conductor can reopen read-only: "archived" (manually
  // archived) and "pushed" (consumed by a Classroom publish). The pushed bucket
  // is a catch-all for any non-active/non-archived status so none are hidden.
  const archivedSessions = useMemo(
    () => allSessions.filter((s) => s.status === "archived"),
    [allSessions],
  );
  const pushedSessions = useMemo(
    () =>
      allSessions.filter(
        (s) => s.status !== "active" && s.status !== "archived",
      ),
    [allSessions],
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Default to the first active session, but never clobber a manual selection
  // of a prior (archived) session the user has opened to review.
  useEffect(() => {
    if (selectedId != null && allSessions.some((s) => s.id === selectedId)) {
      return;
    }
    if (activeSessions.length > 0) {
      setSelectedId(activeSessions[0].id);
    } else if (allSessions.length > 0) {
      setSelectedId(allSessions[0].id);
    } else {
      setSelectedId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSessions]);

  const selectedSession = allSessions.find((s) => s.id === selectedId) ?? null;
  const isReadOnly = !!selectedSession && selectedSession.status !== "active";

  const { data: serverMessages } = useListProfessorMessages(
    tenantId,
    selectedId ?? 0,
    {
      query: {
        enabled: !!tenantId && !!selectedId,
        queryKey: getListProfessorMessagesQueryKey(tenantId, selectedId ?? 0),
      },
    },
  );

  const { data: absorbed } = useListAbsorbedFacts(tenantId, selectedId ?? 0, {
    query: {
      enabled: !!tenantId && !!selectedId,
      queryKey: getListAbsorbedFactsQueryKey(tenantId, selectedId ?? 0),
    },
  });

  const { data: classroom } = useGetCurrentClassroom(tenantId, {
    query: {
      enabled: !!tenantId,
      queryKey: getGetCurrentClassroomQueryKey(tenantId),
    },
  });

  const createSession = useCreateProfessorSession();
  const archiveSession = useArchiveProfessorSession();
  const reopenSession = useReopenProfessorSession();
  const updateFact = useUpdateAbsorbedFactStatus();
  const updateFactCategory = useUpdateAbsorbedFactCategory();
  const pushToClassroom = usePushToClassroom();
  const absorbAnswer = useAbsorbProfessorAnswer();

  const acceptedCount = useMemo(
    () => (absorbed ?? []).filter((f) => f.status === "published").length,
    [absorbed],
  );

  // Which Professor answers have already been turned into absorbed facts, so
  // each answer can show its absorbed state instead of re-offering the action.
  const absorbedMsgIds = useMemo(
    () =>
      new Set(
        (absorbed ?? [])
          .map((f) => f.messageId)
          .filter((id): id is number => id != null),
      ),
    [absorbed],
  );

  // --- chat composer + streaming state --------------------------------------
  const [input, setInput] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages: ChatMessage[] = (serverMessages ?? []).filter(
    (m) => m.role !== "system",
  ) as ChatMessage[];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [serverMessages, streamText, pendingUser]);

  const invalidateSession = (sid: number) => {
    queryClient.invalidateQueries({
      queryKey: getListProfessorMessagesQueryKey(tenantId, sid),
    });
    queryClient.invalidateQueries({
      queryKey: getListAbsorbedFactsQueryKey(tenantId, sid),
    });
    queryClient.invalidateQueries({
      queryKey: getListProfessorSessionsQueryKey(tenantId),
    });
  };

  async function handleSend() {
    const content = input.trim();
    if (!content || !selectedId || isReadOnly || isStreaming) return;
    setInput("");
    setPendingUser(content);
    setStreamText("");
    setIsStreaming(true);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const auth = getStoredAuthHeader();
      if (auth) headers["Authorization"] = auth;
      const resp = await fetch(
        `/api/tenants/${tenantId}/professor/sessions/${selectedId}/stream`,
        { method: "POST", headers, body: JSON.stringify({ content }) },
      );
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const lines = block.split("\n");
          const evLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const event = evLine ? evLine.slice(6).trim() : "message";
          let data: any = {};
          try {
            data = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          if (event === "token" && data.delta) {
            acc += data.delta;
            setStreamText(acc);
          } else if (event === "error") {
            throw new Error(data.error || "Professor error");
          } else if (event === "done") {
            if (data.stubbed) {
              toast({
                title: "Professor offline",
                description: "Connect the Professor AI provider to enable live curation.",
              });
            }
          }
        }
      }
      invalidateSession(selectedId);
    } catch (err) {
      toast({
        title: "Professor error",
        description: err instanceof Error ? err.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setIsStreaming(false);
      setPendingUser(null);
      setStreamText("");
    }
  }

  function handleNewSession() {
    if (activeSessions.length >= MAX_ACTIVE_SESSIONS) return;
    createSession.mutate(
      { tenantId, data: {} },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({
            queryKey: getListProfessorSessionsQueryKey(tenantId),
          });
          setSelectedId(created.id);
        },
        onError: (e: any) =>
          toast({
            title: "Could not create session",
            description: e?.message ?? "Unknown error",
            variant: "destructive",
          }),
      },
    );
  }

  function handleArchive(sessionId?: number) {
    const target = sessionId ?? selectedId;
    if (!target) return;
    archiveSession.mutate(
      { tenantId, sessionId: target },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListProfessorSessionsQueryKey(tenantId),
          });
          toast({ title: "Session archived", description: "Memory slot freed." });
        },
        onError: (e: any) =>
          toast({
            title: "Could not archive session",
            description: e?.message ?? "Unknown error",
            variant: "destructive",
          }),
      },
    );
  }

  function handleReopen(sessionId?: number) {
    const target = sessionId ?? selectedId;
    if (!target) return;
    reopenSession.mutate(
      { tenantId, sessionId: target },
      {
        onSuccess: (reopened) => {
          queryClient.invalidateQueries({
            queryKey: getListProfessorSessionsQueryKey(tenantId),
          });
          setSelectedId(reopened.id);
          toast({
            title: "Session reopened",
            description: "Accept any missed facts, then push to the Classroom again.",
          });
        },
        onError: (e: any) =>
          toast({
            title: "Could not reopen session",
            description: e?.message ?? "Unknown error",
            variant: "destructive",
          }),
      },
    );
  }

  function handlePush() {
    if (isReadOnly) return;
    pushToClassroom.mutate(
      { tenantId, data: {} },
      {
        onSuccess: (snapshot) => {
          queryClient.invalidateQueries({
            queryKey: getGetCurrentClassroomQueryKey(tenantId),
          });
          queryClient.invalidateQueries({
            queryKey: getListProfessorSessionsQueryKey(tenantId),
          });
          if (selectedId) invalidateSession(selectedId);
          const extras: string[] = [];
          if (snapshot.mergedCount)
            extras.push(`${snapshot.mergedCount} duplicate(s) merged`);
          if (snapshot.conflictCount)
            extras.push(
              `${snapshot.conflictCount} conflict(s) flagged for review`,
            );
          toast({
            title: "Published to Classroom",
            description:
              `Version ${snapshot.version?.version ?? "?"} is live with ${snapshot.factCount} facts.` +
              (extras.length ? ` ${extras.join("; ")}.` : ""),
          });
        },
        onError: (e: any) =>
          toast({
            title: "Couldn't publish",
            description:
              e?.message ??
              "Curate some knowledge (or resolve conflicts) before pushing to the Classroom.",
            variant: "destructive",
          }),
      },
    );
  }

  async function setFactStatus(
    factId: number,
    status: "published" | "rejected",
  ) {
    if (!selectedId || isReadOnly) return;
    const queryKey = getListAbsorbedFactsQueryKey(tenantId, selectedId);
    // Stop any in-flight list refetch so it can't clobber the optimistic write
    // before onSettled reconciles.
    await queryClient.cancelQueries({ queryKey });
    const current = queryClient.getQueryData(queryKey);
    const prior = Array.isArray(current)
      ? current.find((f) => f.id === factId)
      : undefined;
    // Optimistically flip just this fact so the ✓/✗, the "N accepted" counter,
    // and the per-source "to review" count respond on click instead of waiting
    // for the network round-trip — the feedback that made accepting feel like it
    // "did nothing".
    queryClient.setQueryData(queryKey, (old) =>
      Array.isArray(old)
        ? old.map((f) =>
            f.id === factId ? { ...f, status, conflictReason: null } : f,
          )
        : old,
    );
    updateFact.mutate(
      { tenantId, factId, data: { status } },
      {
        onError: () => {
          // Revert only this row so a concurrent optimistic change isn't lost.
          if (prior) {
            queryClient.setQueryData(queryKey, (old) =>
              Array.isArray(old)
                ? old.map((f) => (f.id === factId ? prior : f))
                : old,
            );
          }
          toast({
            title: "Couldn't update fact",
            description: "Change reverted — please try again.",
            variant: "destructive",
          });
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey }),
      },
    );
  }

  function setFactCategory(
    factId: number,
    category: AbsorbedFactCategoryInputCategory,
  ) {
    if (!selectedId || isReadOnly) return;
    updateFactCategory.mutate(
      { tenantId, factId, data: { category } },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: getListAbsorbedFactsQueryKey(tenantId, selectedId),
          }),
      },
    );
  }

  const absorbingId =
    absorbAnswer.isPending && absorbAnswer.variables
      ? absorbAnswer.variables.messageId
      : null;

  function handleAbsorbAnswer(messageId: number) {
    if (!selectedId || isReadOnly) return;
    absorbAnswer.mutate(
      { tenantId, sessionId: selectedId, messageId },
      {
        onSuccess: (res) => {
          invalidateSession(selectedId);
          toast({
            title: res.stubbed ? "Professor offline" : "Answer absorbed",
            description: res.stubbed
              ? "Connect the Professor AI provider to extract facts from answers."
              : res.absorbedCount > 0
                ? `${res.absorbedCount} fact${res.absorbedCount === 1 ? "" : "s"} added below — accept the ones you want, then Push to Classroom.`
                : "No distinct facts were found in this answer.",
          });
        },
        onError: (e: any) =>
          toast({
            title: "Could not absorb answer",
            description: e?.message ?? "Unknown error",
            variant: "destructive",
          }),
      },
    );
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isReadOnly) {
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (selectedId) form.append("sessionId", String(selectedId));
      const headers: Record<string, string> = {};
      const auth = getStoredAuthHeader();
      if (auth) headers["Authorization"] = auth;
      const resp = await fetch(`/api/tenants/${tenantId}/library/file`, {
        method: "POST",
        headers,
        body: form,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Upload failed");
      queryClient.invalidateQueries({
        queryKey: getListProfessorSessionsQueryKey(tenantId),
      });
      if (data.session?.id) {
        setSelectedId(data.session.id);
        invalidateSession(data.session.id);
      } else if (selectedId) {
        invalidateSession(selectedId);
      }
      toast({
        title: "Absorbed into Library",
        description: `${file.name}: ${data.absorbedCount ?? 0} facts extracted.`,
      });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // group absorbed facts by source
  const factGroups = useMemo(() => {
    // Reviewed facts (accepted/rejected) sink below the still-pending ones so the
    // actionable items stay at the top and the bucket visibly "drains" as you
    // review — mirroring the Brain review flow the operator is used to.
    const rank: Record<string, number> = {
      conflict: 0,
      draft: 1,
      published: 2,
      rejected: 3,
    };
    const map = new Map<string, typeof absorbed>();
    for (const f of absorbed ?? []) {
      const arr = map.get(f.sourceLabel) ?? [];
      arr.push(f);
      map.set(f.sourceLabel, arr);
    }
    return Array.from(map.entries()).map(([label, facts]) => {
      const sorted = [...(facts ?? [])].sort(
        (a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1),
      );
      const pending = sorted.filter(
        (f) => f.status === "draft" || f.status === "conflict",
      ).length;
      return { label, facts: sorted, pending };
    });
  }, [absorbed]);

  const tokensUsed = selectedSession?.tokensUsed ?? 0;
  const meterPct = Math.min(100, Math.max(tokensUsed > 0 ? 1 : 0, (tokensUsed / MEMORY_BUDGET) * 100));
  const isLive = !!classroom?.version;
  const atCapacity = activeSessions.length >= MAX_ACTIVE_SESSIONS;
  const professorName = tenant ? `Prof. ${tenant.name}` : "Professor";

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] -m-2">
      {/* Top header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-2">
            <GraduationCap size={28} /> Professor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Learn from your niche expert — curate {tenant?.name ?? "tenant"}'s
            knowledge, then push it to the Classroom.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="gap-1 font-mono text-xs py-1.5">
            <Sparkles size={12} className="text-primary" />
            {activeSessions.length}/{MAX_ACTIVE_SESSIONS} memory sessions
          </Badge>
          <div
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium",
              isLive
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                : "border-border bg-muted/40 text-muted-foreground",
            )}
          >
            <Radio size={14} />
            {isLive ? `Live · v${classroom?.version?.version}` : "Not live yet"}
          </div>
        </div>
      </div>

      {/* Sub toolbar */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <Badge className="uppercase tracking-wide bg-primary/15 text-primary border-0">
            {professorName}
          </Badge>
          <span className="text-sm text-muted-foreground truncate">
            {selectedSession ? selectedSession.title : "No active session"}
          </span>
          {isReadOnly && (
            <Badge
              variant="outline"
              className="gap-1 text-[10px] uppercase tracking-wide text-muted-foreground shrink-0"
            >
              <Lock size={10} /> {selectedSession?.status}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 rounded-md border px-3 py-1.5">
            <Sparkles size={14} className="text-primary" />
            <div className="w-28 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${meterPct}%` }}
              />
            </div>
            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
              {formatBudget(tokensUsed)}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => handleArchive()}
            disabled={
              !selectedSession ||
              selectedSession.status !== "active" ||
              archiveSession.isPending
            }
          >
            <Save size={14} /> Archive &amp; Save
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  size="sm"
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handlePush}
                  disabled={pushToClassroom.isPending || isReadOnly}
                >
                  <Upload size={14} />
                  {pushToClassroom.isPending ? "Pushing..." : "Push to Classroom"}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Only accepted facts (✓) are published to the Classroom. Accept or
              reject absorbed facts first.
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Auto-Learned review queue (tenant-scoped, operator-only) */}
      <div className="mb-3 shrink-0">
        <AutoLearnedReviewPanel tenantId={tenantId} />
      </div>

      {/* Main two-pane */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-60 shrink-0 flex flex-col rounded-lg border bg-card">
          <div className="p-3 border-b">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    className="w-full gap-2 border-primary/40 text-primary hover:bg-primary/10"
                    onClick={handleNewSession}
                    disabled={atCapacity || createSession.isPending}
                  >
                    <Plus size={16} /> New Session
                  </Button>
                </span>
              </TooltipTrigger>
              {atCapacity && (
                <TooltipContent>
                  Max {MAX_ACTIVE_SESSIONS} active sessions — archive or push first.
                </TooltipContent>
              )}
            </Tooltip>
          </div>
          <ScrollArea className="flex-1">
            <div className="pb-2">
              <div className="px-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground">
                Active ({activeSessions.length})
              </div>
              <div className="px-2 space-y-1">
                {activeSessions.length === 0 && (
                  <p className="px-2 py-6 text-xs text-muted-foreground text-center">
                    No active sessions. Start one to begin curating.
                  </p>
                )}
                {activeSessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    selected={s.id === selectedId}
                    onSelect={setSelectedId}
                    onArchive={handleArchive}
                    archiving={
                      archiveSession.isPending &&
                      archiveSession.variables?.sessionId === s.id
                    }
                  />
                ))}
              </div>

              {archivedSessions.length > 0 && (
                <>
                  <div className="px-3 pt-4 pb-2 text-[11px] uppercase tracking-widest text-muted-foreground">
                    Archived ({archivedSessions.length})
                  </div>
                  <div className="px-2 space-y-1">
                    {archivedSessions.map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        selected={s.id === selectedId}
                        onSelect={setSelectedId}
                        onReopen={handleReopen}
                        reopening={
                          reopenSession.isPending &&
                          reopenSession.variables?.sessionId === s.id
                        }
                      />
                    ))}
                  </div>
                </>
              )}

              {pushedSessions.length > 0 && (
                <>
                  <div className="px-3 pt-4 pb-2 text-[11px] uppercase tracking-widest text-muted-foreground">
                    Pushed ({pushedSessions.length})
                  </div>
                  <div className="px-2 space-y-1">
                    {pushedSessions.map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        selected={s.id === selectedId}
                        onSelect={setSelectedId}
                        onReopen={handleReopen}
                        reopening={
                          reopenSession.isPending &&
                          reopenSession.variables?.sessionId === s.id
                        }
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Chat pane */}
        <div className="flex-1 flex flex-col rounded-lg border bg-card min-w-0">
          {isReadOnly && (
            <div className="m-3 mb-0 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
              <Lock size={13} className="shrink-0" />
              <span className="flex-1">
                This session is {selectedSession?.status} — read-only. Reopen it
                to accept missed facts, or start a new session.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1.5 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-500"
                onClick={() => handleReopen()}
                disabled={reopenSession.isPending}
              >
                {reopenSession.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RotateCcw size={12} />
                )}
                Reopen
              </Button>
            </div>
          )}
          {/* Absorbed knowledge */}
          {selectedSession && factGroups.length > 0 && (
            <div className="m-3 rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Sparkles size={14} /> Absorbed knowledge ({factGroups.length})
                  <span className="text-xs font-normal text-muted-foreground">
                    · {acceptedCount} accepted
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {Array.from({ length: MAX_ACTIVE_SESSIONS }).map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1 w-5 rounded-full",
                        i < activeSessions.length ? "bg-primary" : "bg-muted",
                      )}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {factGroups.map((g) => (
                  <Popover key={g.label}>
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs hover:bg-muted transition-colors max-w-[18rem]">
                        <Globe size={12} className="text-primary shrink-0" />
                        <span className="truncate">{g.label}</span>
                        <span
                          className={cn(
                            "shrink-0 font-medium",
                            g.pending > 0 ? "text-amber-600" : "text-emerald-600",
                          )}
                        >
                          ·{" "}
                          {g.pending > 0
                            ? `${g.pending} to review`
                            : `${g.facts.length} reviewed`}
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-96 max-h-80 overflow-auto" align="start">
                      <p className="text-xs font-medium mb-2 truncate">{g.label}</p>
                      <div className="space-y-2">
                        {g.facts.map((f) => (
                          <div
                            key={f.id}
                            className={cn(
                              "flex items-start gap-2 text-xs border-b pb-2 last:border-0 transition-colors",
                              f.status === "conflict" &&
                                "rounded-md border border-amber-500/40 bg-amber-500/5 p-2",
                              f.status === "published" &&
                                "rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2",
                              f.status === "rejected" && "opacity-50",
                            )}
                          >
                            <div className="flex-1 space-y-1">
                              <span
                                className={cn(
                                  "block",
                                  f.status === "rejected" &&
                                    "line-through text-muted-foreground",
                                )}
                              >
                                {f.statement}
                              </span>
                              {f.status === "conflict" && (
                                <div className="flex items-start gap-1 text-[11px] text-amber-600">
                                  <AlertTriangle
                                    size={12}
                                    className="mt-0.5 shrink-0"
                                  />
                                  <span>
                                    <span className="font-medium">
                                      Conflict —{" "}
                                    </span>
                                    {f.conflictReason ??
                                      "Contradicts another accepted fact."}{" "}
                                    Accept (✓) the correct one and reject (✗) the
                                    other.
                                  </span>
                                </div>
                              )}
                              <select
                                value={f.category ?? "general"}
                                onChange={(e) =>
                                  setFactCategory(
                                    f.id,
                                    e.target
                                      .value as AbsorbedFactCategoryInputCategory,
                                  )
                                }
                                title="Routing category"
                                disabled={isReadOnly}
                                className={cn(
                                  "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
                                  CATEGORY_CLASSES[f.category ?? "general"] ??
                                    CATEGORY_CLASSES.general,
                                )}
                              >
                                {FACT_CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {CATEGORY_LABELS[c]}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                title="Accept"
                                disabled={isReadOnly}
                                onClick={() => setFactStatus(f.id, "published")}
                                className={cn(
                                  "rounded p-1 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-40",
                                  f.status === "published"
                                    ? "text-emerald-500"
                                    : "text-red-500",
                                )}
                              >
                                <Check size={13} />
                              </button>
                              <button
                                title="Reject"
                                disabled={isReadOnly}
                                onClick={() => setFactStatus(f.id, "rejected")}
                                className={cn(
                                  "rounded p-1 hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-40",
                                  f.status === "rejected"
                                    ? "text-destructive"
                                    : "text-muted-foreground",
                                )}
                              >
                                <X size={13} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3 space-y-4">
            {!selectedSession && (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground gap-3">
                <GraduationCap size={40} className="text-primary/40" />
                <p className="text-sm max-w-sm">
                  Start a new session to chat with {professorName}. Upload a
                  document or paste content, then push the absorbed knowledge to
                  the Classroom so Students can use it.
                </p>
              </div>
            )}

            {selectedSession &&
              messages.length === 0 &&
              !pendingUser &&
              !streamText && (
                <div className="h-full flex items-center justify-center text-center text-sm text-muted-foreground">
                  Say hello to {professorName}, or attach content to absorb.
                </div>
              )}

            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                role={m.role}
                content={m.content}
                professorName={professorName}
                canAbsorb={m.role === "assistant" && !isReadOnly}
                absorbed={absorbedMsgIds.has(m.id)}
                absorbing={absorbingId === m.id}
                onAbsorb={() => handleAbsorbAnswer(m.id)}
              />
            ))}

            {pendingUser && (
              <MessageBubble role="user" content={pendingUser} professorName={professorName} />
            )}
            {(streamText || (isStreaming && !streamText)) && (
              <MessageBubble
                role="assistant"
                content={streamText}
                professorName={professorName}
                streaming={isStreaming && !streamText}
              />
            )}
          </div>

          {/* Composer */}
          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.txt,.md,.csv"
                onChange={handleFile}
                className="hidden"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    disabled={!selectedSession || isReadOnly || uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Upload size={18} />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Upload a file (PDF, TXT, MD, CSV)</TooltipContent>
              </Tooltip>

              <LibraryAddPopover
                tenantId={tenantId}
                sessionId={selectedId}
                disabled={!selectedSession || isReadOnly}
                onAbsorbed={(sid) => {
                  if (sid) {
                    setSelectedId(sid);
                    invalidateSession(sid);
                  } else if (selectedId) {
                    invalidateSession(selectedId);
                  }
                  queryClient.invalidateQueries({
                    queryKey: getListProfessorSessionsQueryKey(tenantId),
                  });
                }}
              />

              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  !selectedSession
                    ? "Start a session to begin"
                    : isReadOnly
                      ? "This session is archived (read-only)"
                      : `Ask ${professorName} a question...`
                }
                disabled={!selectedSession || isReadOnly || isStreaming}
                className="min-h-[44px] max-h-32 resize-none"
              />
              <Button
                className="shrink-0 gap-2"
                onClick={handleSend}
                disabled={!selectedSession || isReadOnly || isStreaming || !input.trim()}
              >
                {isStreaming ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  professorName,
  streaming,
  canAbsorb,
  absorbed,
  absorbing,
  onAbsorb,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  professorName: string;
  streaming?: boolean;
  canAbsorb?: boolean;
  absorbed?: boolean;
  absorbing?: boolean;
  onAbsorb?: () => void;
}) {
  const isUser = role === "user";
  const showAbsorb = !!canAbsorb && !streaming && content.trim().length > 0;
  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="h-8 w-8 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center">
          <GraduationCap size={16} />
        </div>
      )}
      <div className={cn("max-w-[75%]", isUser && "order-1")}>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
          {isUser ? "You" : professorName}
        </div>
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground",
          )}
        >
          {content}
          {streaming && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> thinking…
            </span>
          )}
        </div>
        {showAbsorb && (
          <button
            type="button"
            onClick={absorbed ? undefined : onAbsorb}
            disabled={absorbed || absorbing}
            title={
              absorbed
                ? "This answer has been absorbed into knowledge"
                : "Extract facts from this answer into absorbed knowledge"
            }
            className={cn(
              "mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              absorbed
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500 cursor-default"
                : "border-primary/40 text-primary hover:bg-primary/10",
            )}
          >
            {absorbed ? (
              <>
                <Check size={12} /> Absorbed
              </>
            ) : absorbing ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Absorbing…
              </>
            ) : (
              <>
                <Sparkles size={12} /> Absorb this answer
              </>
            )}
          </button>
        )}
      </div>
      {isUser && (
        <div className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center">
          <User size={16} />
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  selected,
  onSelect,
  onArchive,
  archiving,
  onReopen,
  reopening,
}: {
  session: {
    id: number;
    title: string;
    createdAt: string;
    tokensUsed: number;
    status: string;
  };
  selected: boolean;
  onSelect: (id: number) => void;
  onArchive?: (id: number) => void;
  archiving?: boolean;
  onReopen?: (id: number) => void;
  reopening?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(session.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(session.id);
        }
      }}
      className={cn(
        "group flex items-start gap-2 w-full text-left rounded-md px-3 py-2 transition-colors border cursor-pointer",
        selected
          ? "bg-primary/10 border-primary/40"
          : "border-transparent hover:bg-muted",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{session.title}</div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          <span>{formatDate(session.createdAt)}</span>
          <span className="font-mono">
            {session.tokensUsed.toLocaleString()}
          </span>
        </div>
      </div>
      {onArchive ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              title="Archive session"
              disabled={archiving}
              onClick={(e) => {
                e.stopPropagation();
                onArchive(session.id);
              }}
              className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/10 hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {archiving ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Archive size={13} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>Archive — frees a memory slot</TooltipContent>
        </Tooltip>
      ) : onReopen ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              title="Reopen session"
              disabled={reopening}
              onClick={(e) => {
                e.stopPropagation();
                onReopen(session.id);
              }}
              className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/10 hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reopening ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RotateCcw size={13} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>Reopen — accept missed facts &amp; re-push</TooltipContent>
        </Tooltip>
      ) : (
        <Lock
          size={12}
          className="shrink-0 mt-0.5 text-muted-foreground/50"
          aria-hidden
        />
      )}
    </div>
  );
}

function LibraryAddPopover({
  tenantId,
  sessionId,
  disabled,
  onAbsorbed,
}: {
  tenantId: number;
  sessionId: number | null;
  disabled: boolean;
  onAbsorbed: (newSessionId?: number) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"url" | "paste">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const addUrl = useAddLibraryUrl();
  const addText = useAddLibraryText();
  const busy = addUrl.isPending || addText.isPending;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function reset() {
    setUrl("");
    setText("");
    setTitle("");
  }

  function done(res: any, label: string) {
    onAbsorbed(res?.session?.id);
    toast({
      title: "Absorbed into Library",
      description: `${label}: ${res?.absorbedCount ?? 0} facts extracted.`,
    });
    reset();
    setOpen(false);
  }

  function submit() {
    if (disabled) return;
    if (mode === "url") {
      if (!url.trim()) return;
      addUrl.mutate(
        {
          tenantId,
          data: { url: url.trim(), sessionId: sessionId ?? undefined },
        },
        {
          onSuccess: (r) => done(r, url.trim()),
          onError: (e: any) =>
            toast({
              title: "Could not fetch URL",
              description: e?.message ?? "Unknown error",
              variant: "destructive",
            }),
        },
      );
    } else {
      if (!text.trim()) return;
      addText.mutate(
        {
          tenantId,
          data: {
            text: text.trim(),
            title: title.trim() || "Pasted note",
            sessionId: sessionId ?? undefined,
          },
        },
        {
          onSuccess: (r) => done(r, title.trim() || "Pasted note"),
          onError: (e: any) =>
            toast({
              title: "Could not absorb text",
              description: e?.message ?? "Unknown error",
              variant: "destructive",
            }),
        },
      );
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-primary"
              disabled={disabled}
            >
              <Briefcase size={18} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Add a URL or paste content</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-96" align="start" side="top">
        <div className="flex gap-1 mb-3">
          <Button
            variant={mode === "url" ? "default" : "outline"}
            size="sm"
            className="gap-1 flex-1"
            onClick={() => setMode("url")}
          >
            <Link2 size={14} /> URL
          </Button>
          <Button
            variant={mode === "paste" ? "default" : "outline"}
            size="sm"
            className="gap-1 flex-1"
            onClick={() => setMode("paste")}
          >
            <ClipboardPaste size={14} /> Paste
          </Button>
        </div>
        {mode === "url" ? (
          <Input
            placeholder="https://example.com/article"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        ) : (
          <div className="space-y-2">
            <Input
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              placeholder="Paste knowledge content here..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[120px]"
            />
          </div>
        )}
        <Button
          className="w-full mt-3 gap-2"
          onClick={submit}
          disabled={busy || (mode === "url" ? !url.trim() : !text.trim())}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Absorb into Library
        </Button>
      </PopoverContent>
    </Popover>
  );
}
