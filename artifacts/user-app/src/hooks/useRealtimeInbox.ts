import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListConversationsQueryKey,
  getListMessagesQueryKey,
  getGetConversationQueryKey,
} from "@workspace/api-client-react";
import { getTenantToken } from "@/lib/auth";

type RealtimeEvent =
  | { type: "message:new"; conversationId: number; direction: "inbound" | "outbound" }
  | { type: "conversation:new"; conversationId: number };

/**
 * Subscribe to the SSE event stream and invalidate inbox queries on the fly.
 * One open EventSource per logged-in agent. Auto-reconnects on transient drops
 * (browser default behavior); explicit reconnect on auth/network failure.
 */
export function useRealtimeInbox(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = getTenantToken();
    if (!token) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function open() {
      if (cancelled) return;
      const url = `/api/events/stream?token=${encodeURIComponent(token!)}`;
      es = new EventSource(url);

      es.addEventListener("message", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as RealtimeEvent;
          if (data.type === "message:new") {
            void queryClient.invalidateQueries({
              queryKey: getListMessagesQueryKey(data.conversationId),
            });
            void queryClient.invalidateQueries({
              queryKey: getGetConversationQueryKey(data.conversationId),
            });
            // Conversation list shows last-message timestamp + unread, so refresh it too.
            void queryClient.invalidateQueries({
              queryKey: getListConversationsQueryKey(),
              exact: false,
            });
          }
        } catch {
          /* malformed event — ignore */
        }
      });

      es.addEventListener("conversation", () => {
        void queryClient.invalidateQueries({
          queryKey: getListConversationsQueryKey(),
          exact: false,
        });
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (cancelled) return;
        // Backoff a little before retrying (browser also retries internally,
        // but if the connection was rejected we want a longer pause).
        retryTimer = setTimeout(open, 3000);
      };
    }

    open();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [queryClient]);
}
