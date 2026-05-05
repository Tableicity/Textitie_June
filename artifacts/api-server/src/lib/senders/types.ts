/**
 * Modular message sender contract.
 *
 * Implementations: TwilioSender (Gate 2 — direct REST), StubSender (Gate 1
 * fallback), and later FonosterSender when the German Hetzner node is online.
 * Routes never know which engine is wired — they only call `getSender().send()`.
 *
 * Per-tenant numbers (Gate 3): callers pass `fromOverride` to send "as" a
 * specific tenant; the sender falls back to its default From if absent.
 */
export type SendStatus = "stubbed" | "sent" | "failed";

export type SendResult = {
  status: SendStatus;
  responseSummary: string | null;
  externalId: string | null;
};

export type SendInput = {
  to: string;
  body: string;
  tenantId: number | null;
  conductorAuthorized: boolean;
  fromOverride?: string | null;
  /**
   * Internal `messages.id` for outbound conversation replies. When set, the
   * sender includes it in the Twilio status-callback URL as `?msgId=N` so
   * the delivery webhook can update the row by primary key — eliminates the
   * race where Twilio's status callback arrives before the route persists
   * the externalId. Optional: campaign sends use external_id lookup instead.
   */
  messageId?: number;
};

export interface MessageSender {
  readonly name: string;
  send(input: SendInput): Promise<SendResult>;
}
