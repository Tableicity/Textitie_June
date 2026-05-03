import { useState } from "react";
import { useListWebhookEvents, WebhookSource } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SourceBadge } from "@/components/StatusBadge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, Webhook } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Webhooks() {
  const [filter, setFilter] = useState<WebhookSource | "all">("all");
  const { data: webhooks, isLoading } = useListWebhookEvents({ limit: 200 });

  const filteredWebhooks = webhooks?.filter(w => filter === "all" || w.source === filter) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Webhooks</h1>
        <p className="text-muted-foreground mt-2">Inbound carrier event log.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge 
          variant={filter === "all" ? "default" : "outline"} 
          className="cursor-pointer hover:bg-primary/90"
          onClick={() => setFilter("all")}
        >
          All
        </Badge>
        <Badge 
          variant="secondary"
          className={cn("cursor-pointer border-blue-500/20", filter === "twilio" ? "bg-blue-500/20 text-blue-500" : "bg-blue-500/5 text-blue-500/70")}
          onClick={() => setFilter("twilio")}
        >
          Twilio
        </Badge>
        <Badge 
          variant="secondary"
          className={cn("cursor-pointer border-indigo-500/20", filter === "chatwoot" ? "bg-indigo-500/20 text-indigo-500" : "bg-indigo-500/5 text-indigo-500/70")}
          onClick={() => setFilter("chatwoot")}
        >
          Chatwoot
        </Badge>
        <Badge 
          variant="secondary"
          className={cn("cursor-pointer border-rose-500/20", filter === "n8n" ? "bg-rose-500/20 text-rose-500" : "bg-rose-500/5 text-rose-500/70")}
          onClick={() => setFilter("n8n")}
        >
          n8n
        </Badge>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="w-2/3">Payload</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8">Loading events...</TableCell></TableRow>
            ) : filteredWebhooks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-16">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Webhook size={32} className="opacity-50" />
                    <p>No webhook events recorded.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredWebhooks.map((wh) => (
                <TableRow key={wh.id} className="items-start">
                  <TableCell className="text-sm font-mono text-muted-foreground whitespace-nowrap align-top pt-4">
                    {new Date(wh.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="align-top pt-4">
                    <SourceBadge source={wh.source} />
                  </TableCell>
                  <TableCell className="align-top">
                    <Collapsible className="w-full">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="p-0 h-8 hover:bg-transparent flex items-center gap-2 text-xs font-mono text-muted-foreground">
                          <ChevronDown size={14} /> View JSON
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <pre className="bg-muted p-4 rounded-md text-xs font-mono overflow-auto max-h-[300px]">
                          {JSON.stringify(wh.payload, null, 2)}
                        </pre>
                      </CollapsibleContent>
                    </Collapsible>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
