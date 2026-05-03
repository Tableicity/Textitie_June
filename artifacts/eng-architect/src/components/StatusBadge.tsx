import { Badge } from "@/components/ui/badge";
import { InjectionStatus, WebhookSource } from "@workspace/api-client-react";

export function StatusBadge({ status }: { status: InjectionStatus }) {
  if (status === "stubbed") {
    return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20">Stubbed</Badge>;
  }
  if (status === "sent") {
    return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20">Sent</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">Failed</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

export function SourceBadge({ source }: { source: WebhookSource }) {
  if (source === "twilio") {
    return <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border-blue-500/20">Twilio</Badge>;
  }
  if (source === "chatwoot") {
    return <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 border-indigo-500/20">Chatwoot</Badge>;
  }
  if (source === "n8n") {
    return <Badge variant="secondary" className="bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border-rose-500/20">n8n</Badge>;
  }
  return <Badge variant="outline">{source}</Badge>;
}
