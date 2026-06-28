import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBrandSafetyConfig,
  useUpdateBrandSafetyConfig,
  useListBrandSafetyEvents,
  getGetBrandSafetyConfigQueryKey,
  getListBrandSafetyEventsQueryKey,
  type BrandSafetyEvent,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Tag,
  AlertTriangle,
  History,
} from "lucide-react";

// Parse the editor textarea into a clean list: split on newlines or commas,
// trim, drop empties. The server re-normalizes (dedupe + caps), so this is just
// to turn free text into an array.
function parseEditor(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

// Human label for a recording surface (the column is free-form text).
function surfaceLabel(surface: string): string {
  if (surface === "ai_reply") return "AI reply";
  if (surface === "knowledge") return "Knowledge";
  return surface;
}

function EventRow({ event }: { event: BrandSafetyEvent }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px]">
            {surfaceLabel(event.surface)}
          </Badge>
          {event.detail && (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {event.detail}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {event.replacements} name{event.replacements === 1 ? "" : "s"} scrubbed
          </span>
          {event.residue ? (
            <span className="flex items-center gap-1 font-medium text-destructive">
              <AlertTriangle size={12} /> residue remained
            </span>
          ) : (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-500">
              <ShieldCheck size={12} /> clean
            </span>
          )}
        </div>
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {formatStamp(event.createdAt)}
      </span>
    </div>
  );
}

export default function BrandSafetyPanel({
  tenantId,
  tenantName,
}: {
  tenantId: number;
  tenantName: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config, isLoading: configLoading } = useGetBrandSafetyConfig(
    tenantId,
    { query: { queryKey: getGetBrandSafetyConfigQueryKey(tenantId) } },
  );
  const { data: events, isLoading: eventsLoading } = useListBrandSafetyEvents(
    tenantId,
    { query: { queryKey: getListBrandSafetyEventsQueryKey(tenantId) } },
  );

  const updateConfig = useUpdateBrandSafetyConfig();

  // The textarea is seeded from the loaded config, then owned by the user.
  const [editor, setEditor] = useState("");
  useEffect(() => {
    if (config) setEditor(config.extraCompetitors.join("\n"));
  }, [config]);

  // Dirty = the parsed editor list differs from the persisted extras (order +
  // value sensitive enough for a Save gate; the server dedupes on write).
  const dirty = useMemo(() => {
    if (!config) return false;
    const a = parseEditor(editor);
    const b = config.extraCompetitors;
    if (a.length !== b.length) return true;
    return a.some((v, i) => v !== b[i]);
  }, [editor, config]);

  const onSave = () => {
    const extraCompetitors = parseEditor(editor);
    updateConfig.mutate(
      { tenantId, data: { extraCompetitors } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetBrandSafetyConfigQueryKey(tenantId),
          });
          toast({
            title: "Brand safety updated",
            description: `${tenantName}'s competitor list was saved and applied to the scrubber.`,
          });
        },
        onError: (err) =>
          toast({
            title: "Could not save",
            description: err.message || "An error occurred",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Shield size={16} /> Brand Safety
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            The scrubber rewrites competitor names to the platform brand before
            any reply reaches a customer and before knowledge is published. The
            brand and base list are platform-wide; you can add{" "}
            <strong>{tenantName}</strong>-specific competitor names on top.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {configLoading || !config ? (
            <p className="text-sm text-muted-foreground">Loading config…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <ShieldCheck size={13} /> Platform brand
                  </div>
                  <Badge variant="secondary" className="font-mono">
                    {config.brandName}
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Tag size={13} /> Base competitors ({config.baseCompetitors.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {config.baseCompetitors.length === 0 ? (
                      <span className="text-xs text-muted-foreground">None</span>
                    ) : (
                      config.baseCompetitors.map((name) => (
                        <Badge key={name} variant="outline" className="font-mono text-[11px]">
                          {name}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <ShieldAlert size={13} /> {tenantName}'s extra competitors
                </div>
                <Textarea
                  value={editor}
                  onChange={(e) => setEditor(e.target.value)}
                  placeholder="One competitor name per line (or comma-separated)"
                  className="min-h-28 font-mono text-sm"
                />
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">
                    Layered on top of the base list. Case-insensitive; duplicates
                    are removed on save.
                  </p>
                  <Button
                    size="sm"
                    onClick={onSave}
                    disabled={!dirty || updateConfig.isPending}
                  >
                    {updateConfig.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <History size={16} /> Recent leak events
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Every time the scrubber caught a competitor name in a customer-reaching
            reply or in published knowledge for this tenant, newest first.
          </p>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <p className="text-sm text-muted-foreground">Loading events…</p>
          ) : !events || events.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-6 text-sm text-muted-foreground">
              <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-500" />
              No competitor names have been caught for this tenant.
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
