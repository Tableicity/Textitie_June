import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTenants,
  getListTenantsQueryKey,
  useListBrainCandidates,
  getListBrainCandidatesQueryKey,
  usePullBrainKnowledge,
  usePushBrainToClassroom,
  useUpdateAbsorbedFactCategory,
  useGetCurrentClassroom,
  getGetCurrentClassroomQueryKey,
  type AbsorbedFact,
  type AbsorbedFactCategoryInputCategory,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  BrainCircuit,
  DownloadCloud,
  Upload,
  Radio,
  AlertTriangle,
  Link2,
  Loader2,
} from "lucide-react";

// Mirrors the server taxonomy (artifacts/api-server/src/lib/knowledge.ts) and the
// Professor UI so a Brain fact's category reads identically to a Professor fact.
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

// A candidate is "clean" (pre-checked) when the Brain returned no flag for it.
// Flagged candidates carry their reason in conflictReason and start unchecked so
// a human must consciously opt them in.
function isClean(fact: AbsorbedFact): boolean {
  return !fact.conflictReason;
}

export default function Brain() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: tenants } = useListTenants({
    query: { queryKey: getListTenantsQueryKey() },
  });

  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const tenant = useMemo(
    () => (tenants ?? []).find((t) => t.id === selectedTenantId) ?? null,
    [tenants, selectedTenantId],
  );

  // Default to the first tenant once the list loads.
  useEffect(() => {
    if (selectedTenantId == null && (tenants?.length ?? 0) > 0) {
      setSelectedTenantId(tenants![0].id);
    }
  }, [tenants, selectedTenantId]);

  const tenantId = selectedTenantId ?? 0;

  const { data: candidates, isLoading: loadingCandidates } =
    useListBrainCandidates(tenantId, {
      query: {
        enabled: !!selectedTenantId,
        queryKey: getListBrainCandidatesQueryKey(tenantId),
      },
    });

  const { data: classroom } = useGetCurrentClassroom(tenantId, {
    query: {
      enabled: !!selectedTenantId,
      queryKey: getGetCurrentClassroomQueryKey(tenantId),
    },
  });

  const pull = usePullBrainKnowledge();
  const push = usePushBrainToClassroom();
  const updateCategory = useUpdateAbsorbedFactCategory();

  const rows = useMemo(() => candidates ?? [], [candidates]);

  // Approval selection. Re-seed defaults whenever the candidate set changes
  // (clean = checked, flagged = unchecked) so a fresh pull starts from a sane
  // baseline; manual toggles persist until the next set change.
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const candidateKey = useMemo(
    () => rows.map((r) => r.id).join(","),
    [rows],
  );
  useEffect(() => {
    setChecked(new Set(rows.filter(isClean).map((r) => r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateKey]);

  function toggle(id: number, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const [limit, setLimit] = useState("");

  function invalidateCandidates() {
    queryClient.invalidateQueries({
      queryKey: getListBrainCandidatesQueryKey(tenantId),
    });
  }

  function handlePull() {
    if (!selectedTenantId) return;
    const parsedLimit = limit.trim() ? parseInt(limit.trim(), 10) : undefined;
    const data =
      parsedLimit && !Number.isNaN(parsedLimit) ? { limit: parsedLimit } : {};
    pull.mutate(
      { tenantId, data },
      {
        onSuccess: (res) => {
          invalidateCandidates();
          toast({
            title: "Pulled from Brain",
            description:
              `${res.pulledCount} harvested · ${res.insertedCount} new candidate(s)` +
              (res.skippedCount
                ? ` · ${res.skippedCount} duplicate(s) skipped.`
                : "."),
          });
        },
        onError: (e: any) =>
          toast({
            title: "Brain pull failed",
            description:
              e?.message ??
              "The Brain service could not be reached. Check the BRAIN_BASE_URL and BRAIN_API_KEY secrets.",
            variant: "destructive",
          }),
      },
    );
  }

  function handleCategory(
    factId: number,
    category: AbsorbedFactCategoryInputCategory,
  ) {
    if (!selectedTenantId) return;
    updateCategory.mutate(
      { tenantId, factId, data: { category } },
      { onSuccess: invalidateCandidates },
    );
  }

  function handlePush() {
    if (!selectedTenantId) return;
    const factIds = [...checked];
    if (factIds.length === 0) {
      toast({
        title: "Nothing selected",
        description: "Approve at least one candidate before pushing.",
        variant: "destructive",
      });
      return;
    }
    push.mutate(
      { tenantId, data: { factIds } },
      {
        onSuccess: (snapshot) => {
          invalidateCandidates();
          queryClient.invalidateQueries({
            queryKey: getGetCurrentClassroomQueryKey(tenantId),
          });
          const extras: string[] = [];
          if (snapshot.mergedCount)
            extras.push(`${snapshot.mergedCount} duplicate(s) merged`);
          if (snapshot.conflictCount)
            extras.push(`${snapshot.conflictCount} conflict(s) flagged`);
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
              "Approve at least one candidate (or resolve conflicts) before pushing.",
            variant: "destructive",
          }),
      },
    );
  }

  const selectedCount = checked.size;
  const isLive = !!classroom?.version;

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] -m-2">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-2">
            <BrainCircuit size={28} /> Brain
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Harvest knowledge from the external Brain, review it, then push the
            approved facts into {tenant?.name ?? "the tenant"}'s Classroom —
            alongside Professor knowledge.
          </p>
        </div>
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

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-muted-foreground">Tenant</span>
          <Select
            value={selectedTenantId ? String(selectedTenantId) : undefined}
            onValueChange={(v) => setSelectedTenantId(parseInt(v, 10))}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select a tenant" />
            </SelectTrigger>
            <SelectContent>
              {(tenants ?? []).map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="Max"
            className="w-20"
            disabled={!selectedTenantId || pull.isPending}
          />
          <Button
            variant="outline"
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
            onClick={handlePull}
            disabled={!selectedTenantId || pull.isPending}
          >
            {pull.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <DownloadCloud size={16} />
            )}
            {pull.isPending ? "Pulling..." : "Pull from Brain"}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handlePush}
                  disabled={
                    !selectedTenantId || push.isPending || selectedCount === 0
                  }
                >
                  <Upload size={16} />
                  {push.isPending
                    ? "Pushing..."
                    : `Push ${selectedCount || ""} to Classroom`}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Only checked candidates are published. They join the same Classroom
              snapshot as Professor facts.
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Candidates */}
      <div className="flex-1 min-h-0 rounded-lg border bg-card">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-2">
            {!selectedTenantId && (
              <p className="px-2 py-12 text-sm text-muted-foreground text-center">
                Select a tenant to begin.
              </p>
            )}
            {selectedTenantId && loadingCandidates && (
              <p className="px-2 py-12 text-sm text-muted-foreground text-center">
                Loading candidates…
              </p>
            )}
            {selectedTenantId && !loadingCandidates && rows.length === 0 && (
              <p className="px-2 py-12 text-sm text-muted-foreground text-center">
                No Brain candidates yet. Pull from the Brain to harvest
                knowledge.
              </p>
            )}
            {rows.map((fact) => {
              const flagged = !isClean(fact);
              const on = checked.has(fact.id);
              return (
                <div
                  key={fact.id}
                  className={cn(
                    "flex items-start gap-3 rounded-md border p-3 transition-colors",
                    flagged
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-border bg-background",
                  )}
                >
                  <Checkbox
                    checked={on}
                    onCheckedChange={(v) => toggle(fact.id, v === true)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed">{fact.statement}</p>
                    {flagged && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-600">
                        <AlertTriangle size={12} />
                        {fact.conflictReason}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className="gap-1 text-[10px] uppercase tracking-wide"
                      >
                        {fact.sourceLabel}
                      </Badge>
                      {fact.sourceUrl && (
                        <a
                          href={fact.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Link2 size={12} /> source
                        </a>
                      )}
                      <Select
                        value={fact.category}
                        onValueChange={(v) =>
                          handleCategory(
                            fact.id,
                            v as AbsorbedFactCategoryInputCategory,
                          )
                        }
                      >
                        <SelectTrigger
                          className={cn(
                            "h-6 w-28 text-[11px] border",
                            CATEGORY_CLASSES[fact.category] ??
                              CATEGORY_CLASSES.general,
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FACT_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {CATEGORY_LABELS[c]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
