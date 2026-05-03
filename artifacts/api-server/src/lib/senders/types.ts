/**
 * Modular message sender contract.
 *
 * Implementations: TwilioSender (Gate 2 — direct REST), StubSender (Gate 1
 * fallback), and later FonosterSender when the German Hetzner node is online.
 * Routes never know which engine is wired — they only call `getSender().send()`.
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
};

export interface MessageSender {
  readonly name: string;
  send(input: SendInput): Promise<SendResult>;
}
