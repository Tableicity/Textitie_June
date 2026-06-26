import { useQueryClient } from "@tanstack/react-query";
import {
  useListAutoLearnedFacts,
  getListAutoLearnedFactsQueryKey,
  useApproveAutoLearnedFact,
  useRejectAutoLearnedFact,
  getGetCurrentClassroomQueryKey,
  type AbsorbedFact,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Check, X, AlertTriangle, Loader2, Radar } from "lucide-react";

/**
 * Operator-only review queue for self-learned Professor facts.
 *
 * The live Professor escalation persists facts WITHOUT a human in the loop:
 *   - `auto_published`: live-provisional truth — already groundable by Students,
 *     awaiting operator sign-off.
 *   - `conflict`: held out of the live Classroom (NOT groundable) because it
 *     contradicts existing truth; carries a `conflictReason`.
 *
 * Approve promotes a fact to `published` truth (inserting a conflict fact into
 * the current Classroom version). Reject marks it `rejected` and removes any
 * groundable Classroom row. Both mutations run server-side under the Classroom
 * advisory lock; here we just invalidate the queue + the live Classroom view.
 */
export function AutoLearnedReviewPanel({ tenantId }: { tenantId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useListAutoLearnedFacts(tenantId, {
    query: { queryKey: getListAutoLearnedFactsQueryKey(tenantId) },
  });
  const approve = useApproveAutoLearnedFact();
  const reject = useRejectAutoLearnedFact();

  const facts = (data ?? []) as AbsorbedFact[];

  // Render nothing until there's something to review — keeps the Professor page
  // clean when the self-learning loop hasn't staged anything.
  if (isLoading || facts.length === 0) return null;

  const busy = approve.isPending || reject.isPending;

  const invalidate = () => {
    qc.invalidateQueries({
      queryKey: getListAutoLearnedFactsQueryKey(tenantId),
    });
    // Approve/reject can add or remove groundable Classroom rows.
    qc.invalidateQueries({
      queryKey: getGetCurrentClassroomQueryKey(tenantId),
    });
  };

  const onApprove = (fact: AbsorbedFact) => {
    approve.mutate(
      { tenantId, factId: fact.id },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: "Approved",
            description: "Fact promoted to published truth.",
          });
        },
        onError: (err) =>
          toast({
            title: "Could not approve",
            description: err instanceof Error ? err.message : "Request failed.",
            variant: "destructive",
          }),
      },
    );
  };

  const onReject = (fact: AbsorbedFact) => {
    reject.mutate(
      { tenantId, factId: fact.id },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: "Rejected",
            description: "Fact removed from the live Classroom.",
          });
        },
        onError: (err) =>
          toast({
            title: "Could not reject",
            description: err instanceof Error ? err.message : "Request failed.",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.04] p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-500">
        <Radar size={15} />
        Auto-Learned · Pending Review
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold">
          {facts.length}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        The Professor learned these autonomously while answering customers.
        Approve to keep them as published truth, or reject to pull them from the
        live Classroom.
      </p>

      <div className="max-h-72 space-y-2 overflow-auto pr-1">
        {facts.map((f) => {
          const isHeld = f.status === "conflict";
          const targeted =
            (approve.isPending && approve.variables?.factId === f.id) ||
            (reject.isPending && reject.variables?.factId === f.id);
          return (
            <div
              key={f.id}
              className={cn(
                "rounded-md border bg-background p-2.5 text-xs",
                isHeld ? "border-rose-500/40" : "border-amber-500/30",
              )}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="leading-relaxed">{f.statement}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        isHeld
                          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-500",
                      )}
                    >
                      {isHeld ? "Held · needs review" : "Live · pending review"}
                    </span>
                    <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {f.category}
                    </span>
                    {f.sourceLabel && (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {f.sourceLabel}
                      </span>
                    )}
                  </div>
                  {isHeld && (
                    <div className="flex items-start gap-1 text-[11px] text-rose-600 dark:text-rose-400">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      <span>
                        <span className="font-medium">Conflict — </span>
                        {f.conflictReason ??
                          "Contradicts existing published truth."}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {targeted ? (
                    <Loader2 size={16} className="animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Approve — keep as published truth"
                        disabled={busy}
                        onClick={() => onApprove(f)}
                        className="h-7 w-7 text-emerald-600 hover:bg-emerald-500/15 hover:text-emerald-600"
                      >
                        <Check size={15} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Reject — remove from the live Classroom"
                        disabled={busy}
                        onClick={() => onReject(f)}
                        className="h-7 w-7 text-destructive hover:bg-destructive/15 hover:text-destructive"
                      >
                        <X size={15} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
