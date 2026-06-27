import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMigrations,
  useStartMigration,
  useGetMigration,
  useHydrateMigration,
  useActivateMigration,
  useDiscardMigration,
  getListMigrationsQueryKey,
  getGetMigrationQueryKey,
  type MigrationJob,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  DatabaseZap,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Rocket,
  Trash2,
  PlayCircle,
} from "lucide-react";

const TERMINAL_STATUSES = ["complete", "failed", "discarded"] as const;

// The extraction → hydration pipeline, in order. Used to render a coarse
// progress bar: the cursor (page) advances opaquely during extraction (the
// total page count is unknown for a multi-year pull), so the bar tracks the
// pipeline STAGE rather than a true percentage.
const PIPELINE = [
  "pending",
  "extracting",
  "extracted",
  "verifying",
  "verified",
  "review",
  "hydrating",
  "complete",
] as const;

// A lenient view over the worker-written summary JSON (typed as an open record
// in the generated client). All fields optional so a partial/older summary
// never throws while rendering.
type SummaryView = {
  conversations?: { imported?: number; flagged?: number };
  messages?: { imported?: number; skippedMms?: number };
  contacts?: {
    uniquePhones?: number;
    aliasCollapsed?: number;
    missingPhone?: number;
    mergedIntoLive?: number;
  };
  anomalies?: { type: string; ref: string | null; detail: string }[];
  anomalyCount?: number;
  generatedAt?: string;
  flippedAt?: string;
};

function summaryOf(job: MigrationJob): SummaryView | null {
  return (job.summary as SummaryView | null) ?? null;
}

function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

// A 'complete' job is only truly finished once flipped live; until then it sits
// in an operator go-live gate rather than history.
function isAwaitingGoLive(job: MigrationJob): boolean {
  return job.status === "complete" && !summaryOf(job)?.flippedAt;
}

function stageProgress(status: string): number {
  if (status === "discarded" || status === "failed") return 0;
  const idx = PIPELINE.indexOf(status as (typeof PIPELINE)[number]);
  if (idx < 0) return 0;
  return Math.round((idx / (PIPELINE.length - 1)) * 100);
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "complete") return "default";
  if (status === "failed" || status === "discarded") return "destructive";
  if (isTerminal(status)) return "secondary";
  return "outline";
}

function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function CountsGrid({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No rows staged yet.</p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="rounded-md border bg-muted/30 px-3 py-2"
        >
          <div className="text-lg font-semibold tabular-nums">
            {value.toLocaleString()}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {key.replace(/_/g, " ")}
          </div>
        </div>
      ))}
    </div>
  );
}

// The verify/hydrate review summary: imported/skipped tallies plus a capped list
// of anomalies (non-PII refs only — never message bodies).
function SummaryReview({ summary }: { summary: SummaryView }) {
  const stats: { label: string; value: number | undefined }[] = [
    { label: "conversations", value: summary.conversations?.imported },
    { label: "flagged", value: summary.conversations?.flagged },
    { label: "messages", value: summary.messages?.imported },
    { label: "skipped MMS", value: summary.messages?.skippedMms },
    { label: "unique phones", value: summary.contacts?.uniquePhones },
    { label: "alias collapsed", value: summary.contacts?.aliasCollapsed },
    { label: "missing phone", value: summary.contacts?.missingPhone },
    { label: "merged into live", value: summary.contacts?.mergedIntoLive },
  ].filter((s) => typeof s.value === "number");

  const anomalies = summary.anomalies ?? [];
  const shown = anomalies.slice(0, 25);
  const hiddenCount =
    (summary.anomalyCount ?? anomalies.length) - shown.length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-lg font-semibold tabular-nums">
              {(s.value ?? 0).toLocaleString()}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {anomalies.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Anomalies ({summary.anomalyCount ?? anomalies.length})
          </p>
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2">
            {shown.map((a, i) => (
              <div key={i} className="text-xs">
                <span className="font-mono text-amber-600 dark:text-amber-500">
                  {a.type}
                </span>{" "}
                {a.ref && (
                  <span className="font-mono text-muted-foreground">
                    [{a.ref}]
                  </span>
                )}{" "}
                <span className="text-foreground">{a.detail}</span>
              </div>
            ))}
            {hiddenCount > 0 && (
              <p className="text-xs text-muted-foreground">
                …and {hiddenCount.toLocaleString()} more.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Gated operator actions for a single job. Self-gates: renders only the buttons
// valid for the job's current state, and nothing at all when no action applies.
function MigrationActions({
  tenantId,
  job,
}: {
  tenantId: number;
  job: MigrationJob;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const hydrate = useHydrateMigration();
  const flip = useActivateMigration();
  const discard = useDiscardMigration();

  const status = job.status;
  const flipped = Boolean(summaryOf(job)?.flippedAt);
  const canHydrate = status === "review";
  const canFlip = status === "complete" && !flipped;
  const canDiscard =
    ["review", "verified", "failed"].includes(status) ||
    (status === "complete" && !flipped);

  if (!canHydrate && !canFlip && !canDiscard) return null;

  const anyPending = hydrate.isPending || flip.isPending || discard.isPending;

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: getListMigrationsQueryKey(tenantId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetMigrationQueryKey(tenantId, job.id),
    });
  };

  const onHydrate = () =>
    hydrate.mutate(
      { tenantId, jobId: job.id },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: "Hydration queued",
            description:
              "Imported rows are being promoted into the quarantined live tables.",
          });
        },
        onError: (err) =>
          toast({
            title: "Could not hydrate",
            description: err.message || "An error occurred",
            variant: "destructive",
          }),
      },
    );

  const onFlip = () =>
    flip.mutate(
      { tenantId, jobId: job.id },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: "Migration flipped live",
            description: "Imported data is now visible in the live inbox.",
          });
        },
        onError: (err) =>
          toast({
            title: "Could not flip live",
            description: err.message || "An error occurred",
            variant: "destructive",
          }),
      },
    );

  const onDiscard = () =>
    discard.mutate(
      { tenantId, jobId: job.id },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: "Migration discarded",
            description:
              "All quarantined and staged data for this migration was removed.",
          });
        },
        onError: (err) =>
          toast({
            title: "Could not discard",
            description: err.message || "An error occurred",
            variant: "destructive",
          }),
      },
    );

  return (
    <div className="flex flex-wrap gap-2">
      {canHydrate && (
        <Button size="sm" disabled={anyPending} onClick={onHydrate}>
          <PlayCircle className="mr-1.5 h-4 w-4" />
          {hydrate.isPending ? "Hydrating…" : "Hydrate into quarantine"}
        </Button>
      )}

      {canFlip && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" disabled={anyPending}>
              <Rocket className="mr-1.5 h-4 w-4" />
              {flip.isPending ? "Flipping…" : "Flip live"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Flip this migration live?</AlertDialogTitle>
              <AlertDialogDescription>
                This reveals every imported conversation, message, and contact in
                the live inbox. Imported contacts are merged into any existing
                live contact that shares the same phone number. If a phone can't
                be safely merged, the flip is blocked so you can resolve it
                first. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onFlip}>Flip live</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {canDiscard && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={anyPending}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              {discard.isPending ? "Discarding…" : "Discard"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard this migration?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes every quarantined imported row and all
                staged data for this migration. Live data is never touched. This
                can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDiscard}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Discard migration
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function JobProgress({
  tenantId,
  job,
}: {
  tenantId: number;
  job: MigrationJob;
}) {
  const queryClient = useQueryClient();

  // Live-poll the active job; once it goes terminal, stop polling (React Query
  // v5 supports a function form of refetchInterval that returns false to halt).
  const { data: live } = useGetMigration(tenantId, job.id, {
    query: {
      queryKey: getGetMigrationQueryKey(tenantId, job.id),
      initialData: job,
      refetchInterval: (query) =>
        isTerminal(query.state.data?.status ?? job.status) ? false : 3000,
    },
  });

  const current = live ?? job;
  const summary = summaryOf(current);

  // When the live job transitions to a terminal state, refresh the list so this
  // card collapses into history. (v5 removed query onSuccess callbacks.)
  useEffect(() => {
    if (isTerminal(current.status)) {
      queryClient.invalidateQueries({
        queryKey: getListMigrationsQueryKey(tenantId),
      });
    }
  }, [current.status, tenantId, queryClient]);

  const rateLimited =
    current.rateLimitedUntil &&
    new Date(current.rateLimitedUntil).getTime() > Date.now();

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant={statusBadgeVariant(current.status)}>
            {current.status}
          </Badge>
          {!isTerminal(current.status) && (
            <Loader2
              size={14}
              className="animate-spin text-muted-foreground"
            />
          )}
          {current.currentEntity && (
            <span className="text-xs text-muted-foreground">
              extracting{" "}
              <span className="font-mono">{current.currentEntity}</span>
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          job #{current.id}
        </span>
      </div>

      <Progress value={stageProgress(current.status)} />

      <CountsGrid counts={current.counts ?? {}} />

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          page cursor:{" "}
          <span className="font-mono text-foreground">
            {current.pageCursor}
          </span>
        </span>
        {current.attempts > 0 && (
          <span>
            consecutive failures:{" "}
            <span className="font-mono text-foreground">
              {current.attempts}
            </span>
          </span>
        )}
        <span>updated: {formatStamp(current.updatedAt)}</span>
      </div>

      {rateLimited && (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertTitle>Rate limited — backing off</AlertTitle>
          <AlertDescription>
            TextLine throttled the pull. The worker will resume automatically
            after {formatStamp(current.rateLimitedUntil)}.
          </AlertDescription>
        </Alert>
      )}

      {current.status === "review" && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Verified — ready to review</AlertTitle>
          <AlertDescription>
            The import was verified without writing anything live. Review the
            summary below, then hydrate it into the quarantined tables.
          </AlertDescription>
        </Alert>
      )}

      {current.status === "hydrating" && (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertTitle>Hydrating into quarantine</AlertTitle>
          <AlertDescription>
            Promoting imported rows into the live tables (quarantined). This
            resumes safely if interrupted.
          </AlertDescription>
        </Alert>
      )}

      {current.status === "failed" && current.lastError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Migration failed</AlertTitle>
          <AlertDescription className="break-words">
            {current.lastError}
          </AlertDescription>
        </Alert>
      )}

      {summary && (current.status === "review" || current.status === "hydrating") && (
        <SummaryReview summary={summary} />
      )}

      <MigrationActions tenantId={tenantId} job={current} />
    </div>
  );
}

// A completed-but-not-yet-flipped migration: the operator go-live gate.
function GoLiveCard({
  tenantId,
  job,
}: {
  tenantId: number;
  job: MigrationJob;
}) {
  const summary = summaryOf(job);
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="default">{job.status}</Badge>
          <span className="text-xs text-muted-foreground">
            quarantined — not yet live
          </span>
        </div>
        <span className="text-xs text-muted-foreground">job #{job.id}</span>
      </div>

      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>Hydrated &amp; quarantined</AlertTitle>
        <AlertDescription>
          All imported data is staged in the live tables but hidden from the
          inbox. Flip it live to reveal it, or discard to remove it.
        </AlertDescription>
      </Alert>

      {summary && <SummaryReview summary={summary} />}

      <MigrationActions tenantId={tenantId} job={job} />
    </div>
  );
}

export default function MigrationsPanel({
  tenantId,
  tenantName,
}: {
  tenantId: number;
  tenantName: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");

  const { data: jobs, isLoading } = useListMigrations(tenantId, {
    query: { queryKey: getListMigrationsQueryKey(tenantId) },
  });

  const startMigration = useStartMigration();

  const activeJob = useMemo(
    () => (jobs ?? []).find((j) => !isTerminal(j.status)) ?? null,
    [jobs],
  );
  const awaitingGoLive = useMemo(
    () => (jobs ?? []).filter((j) => isAwaitingGoLive(j)),
    [jobs],
  );
  const history = useMemo(
    () => (jobs ?? []).filter((j) => isTerminal(j.status) && !isAwaitingGoLive(j)),
    [jobs],
  );

  const onStart = () => {
    const accessToken = token.trim();
    if (!accessToken) return;
    startMigration.mutate(
      { tenantId, data: { accessToken } },
      {
        onSuccess: () => {
          setToken("");
          queryClient.invalidateQueries({
            queryKey: getListMigrationsQueryKey(tenantId),
          });
          toast({
            title: "Migration started",
            description: `Importing ${tenantName}'s TextLine data. Progress updates below.`,
          });
        },
        onError: (err) => {
          toast({
            title: "Could not start migration",
            description: err.message || "An error occurred",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <DatabaseZap size={16} /> TextLine Migration
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Import {tenantName}'s conversations, contacts, tags, and agent
            attribution from TextLine. Imported data lands{" "}
            <strong>quarantined</strong> — it never appears in the live inbox
            until you flip it live. Paste the tenant's TextLine API access
            token to begin; it is encrypted at rest and never logged.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {activeJob ? (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertTitle>A migration is already in progress</AlertTitle>
              <AlertDescription>
                Only one migration can run per tenant at a time. Watch its
                progress below.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <KeyRound
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="TextLine API access token"
                  className="pl-9 font-mono"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              <Button
                onClick={onStart}
                disabled={startMigration.isPending || token.trim().length === 0}
              >
                {startMigration.isPending ? "Starting…" : "Start Migration"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading migrations…</p>
      ) : (
        <>
          {activeJob && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Active migration</h3>
              <JobProgress tenantId={tenantId} job={activeJob} />
            </div>
          )}

          {awaitingGoLive.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Awaiting go-live</h3>
              <div className="space-y-3">
                {awaitingGoLive.map((j) => (
                  <GoLiveCard key={j.id} tenantId={tenantId} job={j} />
                ))}
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">History</h3>
              <div className="space-y-2">
                {history.map((j) => {
                  const flippedAt = summaryOf(j)?.flippedAt;
                  return (
                    <div
                      key={j.id}
                      className="flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant={statusBadgeVariant(j.status)}>
                          {j.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          job #{j.id}
                        </span>
                        {flippedAt && (
                          <span className="text-xs text-muted-foreground">
                            flipped live {formatStamp(flippedAt)}
                          </span>
                        )}
                        {j.lastError && j.status === "failed" && (
                          <span className="max-w-md truncate text-xs text-destructive">
                            {j.lastError}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <MigrationActions tenantId={tenantId} job={j} />
                        <span className="text-xs text-muted-foreground">
                          {formatStamp(j.updatedAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!activeJob &&
            awaitingGoLive.length === 0 &&
            history.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No migrations yet for this tenant.
              </p>
            )}
        </>
      )}
    </div>
  );
}
