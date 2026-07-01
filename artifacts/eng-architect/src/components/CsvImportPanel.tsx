import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCsvImports,
  useFlipCsvImportLive,
  useDiscardCsvImport,
  getListCsvImportsQueryKey,
  type CsvImportJob,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  FileSpreadsheet,
  Upload,
  Rocket,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { getStoredAuthHeader } from "@/lib/auth";

type DuplicateResolution = "update" | "skip";

// A lenient view over the summary JSON (typed as an open record in the generated
// client). Every field optional so a partial/older summary never throws.
type CsvSummaryView = {
  total?: number;
  valid?: number;
  duplicate?: number;
  invalid?: number;
  sampleInvalid?: { rowNumber?: number; reason?: string | null }[];
  sampleDuplicate?: {
    rowNumber?: number;
    phone?: string | null;
    name?: string | null;
  }[];
  parseErrors?: { row?: number | null; message?: string }[];
  flippedAt?: string;
  duplicateResolution?: DuplicateResolution;
  inserted?: number;
  updated?: number;
  skippedDuplicates?: number;
};

const TERMINAL_STATUSES = ["complete", "discarded", "failed"] as const;

function summaryOf(job: CsvImportJob): CsvSummaryView | null {
  return (job.summary as CsvSummaryView | null) ?? null;
}

function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "complete") return "default";
  if (status === "failed" || status === "discarded") return "destructive";
  return "outline";
}

function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

// The pre-flip review: counts + a capped list of invalid and duplicate examples
// so the operator knows exactly what will (and won't) be imported.
function ReviewSummary({ summary }: { summary: CsvSummaryView }) {
  const invalid = summary.sampleInvalid ?? [];
  const duplicate = summary.sampleDuplicate ?? [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="total rows" value={summary.total ?? 0} />
        <StatTile label="new" value={summary.valid ?? 0} />
        <StatTile label="duplicates" value={summary.duplicate ?? 0} />
        <StatTile label="invalid" value={summary.invalid ?? 0} />
      </div>

      {invalid.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Invalid rows (skipped — never imported)
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2">
            {invalid.map((r, i) => (
              <div key={i} className="text-xs">
                <span className="font-mono text-muted-foreground">
                  row {r.rowNumber ?? "?"}
                </span>{" "}
                <span className="text-foreground">{r.reason ?? "invalid"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {duplicate.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Duplicate rows (phone already a live contact)
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2">
            {duplicate.map((r, i) => (
              <div key={i} className="text-xs">
                <span className="font-mono text-muted-foreground">
                  row {r.rowNumber ?? "?"}
                </span>{" "}
                <span className="font-mono text-foreground">{r.phone ?? ""}</span>
                {r.name && (
                  <span className="text-muted-foreground"> — {r.name}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The post-flip result: what actually happened at go-live.
function ResultSummary({ summary }: { summary: CsvSummaryView }) {
  const stats: { label: string; value: number | undefined }[] = [
    { label: "inserted", value: summary.inserted },
    { label: "updated", value: summary.updated },
    { label: "skipped dupes", value: summary.skippedDuplicates },
    { label: "invalid", value: summary.invalid },
  ].filter((s) => typeof s.value === "number");
  if (stats.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map((s) => (
        <StatTile key={s.label} label={s.label} value={s.value ?? 0} />
      ))}
    </div>
  );
}

// The review → flip-live gate for a single staged job.
function CsvJobActions({ tenantId, job }: { tenantId: number; job: CsvImportJob }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const flip = useFlipCsvImportLive();
  const discard = useDiscardCsvImport();
  const [resolution, setResolution] = useState<DuplicateResolution>("skip");

  const summary = summaryOf(job);
  const duplicateCount = summary?.duplicate ?? 0;
  const anyPending = flip.isPending || discard.isPending;

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListCsvImportsQueryKey(tenantId),
    });

  const onFlip = () =>
    flip.mutate(
      { tenantId, jobId: job.id, data: { duplicateResolution: resolution } },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: "Import flipped live",
            description: "The contacts are now in the live contact list.",
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
            title: "Import discarded",
            description: "The staged rows were removed. Live data was untouched.",
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
    <div className="space-y-3">
      {duplicateCount > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            When a phone already has a live contact ({duplicateCount})
          </label>
          <Select
            value={resolution}
            onValueChange={(v) => setResolution(v as DuplicateResolution)}
          >
            <SelectTrigger className="sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">Skip — keep the existing contact</SelectItem>
              <SelectItem value="update">
                Update — overwrite with the CSV values
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" disabled={anyPending}>
              <Rocket className="mr-1.5 h-4 w-4" />
              {flip.isPending ? "Flipping…" : "Flip live"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Flip this import live?</AlertDialogTitle>
              <AlertDialogDescription>
                This adds {summary?.valid ?? 0} new contact(s) to the live
                contact list
                {duplicateCount > 0
                  ? resolution === "update"
                    ? `, and updates ${duplicateCount} existing contact(s) with the CSV values.`
                    : `, and skips ${duplicateCount} row(s) whose phone already exists.`
                  : "."}{" "}
                Invalid rows are never imported. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onFlip}>Flip live</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={anyPending}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              {discard.isPending ? "Discarding…" : "Discard"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard this import?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the staged rows for this upload. Live
                data is never touched. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDiscard}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Discard import
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function ReviewCard({ tenantId, job }: { tenantId: number; job: CsvImportJob }) {
  const summary = summaryOf(job);
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{job.status}</Badge>
          <span className="text-xs text-muted-foreground">
            staged — not yet live
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {job.originalFilename ?? `import #${job.id}`}
        </span>
      </div>

      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>Ready to review</AlertTitle>
        <AlertDescription>
          The file was parsed and validated without writing anything live.
          Review the counts below, choose how to handle duplicates, then flip it
          live.
        </AlertDescription>
      </Alert>

      {summary && <ReviewSummary summary={summary} />}

      <CsvJobActions tenantId={tenantId} job={job} />
    </div>
  );
}

function HistoryCard({ job }: { job: CsvImportJob }) {
  const summary = summaryOf(job);
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant={statusBadgeVariant(job.status)}>{job.status}</Badge>
          {job.status === "complete" && (
            <span className="text-xs text-muted-foreground">
              {summary?.duplicateResolution === "update"
                ? "duplicates updated"
                : "duplicates skipped"}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {job.originalFilename ?? `import #${job.id}`}
        </span>
      </div>

      {job.status === "complete" && summary && (
        <ResultSummary summary={summary} />
      )}

      <div className="text-xs text-muted-foreground">
        {job.status === "complete" && summary?.flippedAt
          ? `flipped live: ${formatStamp(summary.flippedAt)}`
          : `updated: ${formatStamp(job.updatedAt)}`}
      </div>
    </div>
  );
}

export default function CsvImportPanel({ tenantId }: { tenantId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: jobs, isLoading } = useListCsvImports(tenantId, {
    query: { queryKey: getListCsvImportsQueryKey(tenantId) },
  });

  const reviewJob = (jobs ?? []).find((j) => j.status === "review") ?? null;
  const history = (jobs ?? []).filter((j) => isTerminal(j.status));

  const resetFileInput = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const auth = getStoredAuthHeader();
      const res = await fetch(`/api/tenants/${tenantId}/csv-imports`, {
        method: "POST",
        headers: auth ? { Authorization: auth } : undefined,
        body: form,
      });
      if (!res.ok) {
        let msg = `Upload failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          // non-JSON error body; keep the generic message
        }
        throw new Error(msg);
      }
      resetFileInput();
      queryClient.invalidateQueries({
        queryKey: getListCsvImportsQueryKey(tenantId),
      });
      toast({
        title: "CSV staged for review",
        description: "Review the summary below, then flip it live.",
      });
    } catch (err) {
      toast({
        title: "Could not import CSV",
        description: err instanceof Error ? err.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <FileSpreadsheet size={16} /> CSV Contact Import
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Bulk-add contacts from a CSV. Required column: <strong>phone</strong>.
          Optional: name, email, location, notes, tags. Rows are parsed and{" "}
          <strong>staged for review</strong> — nothing touches the live contact
          list until you flip it live. Invalid rows are reported and never
          imported; duplicates (phone already a live contact) are resolved per
          import.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {reviewJob ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>An import is awaiting review</AlertTitle>
            <AlertDescription>
              Flip it live or discard it below before starting another import.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="flex-1"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button onClick={onUpload} disabled={uploading || !file}>
              <Upload className="mr-1.5 h-4 w-4" />
              {uploading ? "Uploading…" : "Upload & review"}
            </Button>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading imports…</p>
        ) : (
          <>
            {reviewJob && <ReviewCard tenantId={tenantId} job={reviewJob} />}

            {history.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <XCircle size={12} /> History
                </p>
                {history.map((job) => (
                  <HistoryCard key={job.id} job={job} />
                ))}
              </div>
            )}

            {!reviewJob && history.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No imports yet. Upload a CSV to get started.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
