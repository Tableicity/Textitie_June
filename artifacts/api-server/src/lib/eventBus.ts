import { EventEmitter } from "node:events";

/**
 * Process-wide event bus for real-time inbox updates.
 * Each event is scoped to a tenantId so SSE subscribers only receive their own.
 *
 * Event shape: `tenant:{tenantId}` channel emits payloads like
 *   { type: "message:new", conversationId, direction }
 *   { type: "conversation:new", conversationId }
 */
export type RealtimeEvent =
  | { type: "message:new"; conversationId: number; direction: "inbound" | "outbound" }
  | { type: "conversation:new"; conversationId: number };

class TenantEventBus extends EventEmitter {
  constructor() {
    super();
    // Many SSE subscribers per tenant — disable the default 10-listener warning.
    this.setMaxListeners(0);
  }

  channel(tenantId: number): string {
    return `tenant:${tenantId}`;
  }

  publish(tenantId: number, event: RealtimeEvent): void {
    this.emit(this.channel(tenantId), event);
  }

  subscribe(tenantId: number, handler: (event: RealtimeEvent) => void): () => void {
    const ch = this.channel(tenantId);
    this.on(ch, handler);
    return () => {
      this.off(ch, handler);
    };
  }
}

export const eventBus = new TenantEventBus();
