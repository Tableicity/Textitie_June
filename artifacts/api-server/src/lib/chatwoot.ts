import { logger } from "./logger";

/**
 * Chatwoot API client. STUBBED until CHATWOOT_BASE_URL and
 * CHATWOOT_API_ACCESS_TOKEN are set as secrets — the methods log and return
 * a synthetic result so the rest of the pipeline keeps flowing.
 */

export type ChatwootMessageResult = {
  status: "stubbed" | "sent" | "failed";
  conversationId: number | null;
  messageId: number | null;
  detail: string;
};

function chatwootEnv() {
  const base = process.env["CHATWOOT_BASE_URL"]?.trim();
  const token = process.env["CHATWOOT_API_ACCESS_TOKEN"]?.trim();
  if (!base || !token) return null;
  return { base: base.replace(/\/+$/, ""), token };
}

/**
 * Find or create a contact in Chatwoot (matched by phone number), then find
 * or create a conversation in the given inbox, then post a message.
 *
 * `messageType` "outgoing" + `private: true` = a Whisper / Private Note that
 * only Chatwoot agents can see. "incoming" = a customer-side message
 * (used by the inbound router when SMS arrives from a real handset).
 */
export type ChatwootInboxResult = {
  status: "stubbed" | "created" | "failed";
  inboxId: number | null;
  accountId: number | null;
  detail: string;
};

export async function provisionChatwootInbox(
  tenantName: string,
  accountId?: number,
): Promise<ChatwootInboxResult> {
  const env = chatwootEnv();
  if (!env) {
    return {
      status: "stubbed",
      inboxId: null,
      accountId: null,
      detail: "Stubbed: CHATWOOT_BASE_URL / CHATWOOT_API_ACCESS_TOKEN not set",
    };
  }
  const acctId = accountId ?? Number(process.env["CHATWOOT_ACCOUNT_ID"] ?? "1");
  try {
    const resp = await fetch(
      `${env.base}/api/v1/accounts/${acctId}/inboxes`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          api_access_token: env.token,
        },
        body: JSON.stringify({
          name: `SAMA - ${tenantName}`,
          channel: { type: "api", webhook_url: "" },
        }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        status: "failed",
        inboxId: null,
        accountId: acctId,
        detail: `Chatwoot inbox creation failed: ${resp.status} ${text.slice(0, 200)}`,
      };
    }
    const json = (await resp.json()) as { id?: number };
    if (!json.id) {
      return {
        status: "failed",
        inboxId: null,
        accountId: acctId,
        detail: "Chatwoot inbox creation returned no id",
      };
    }
    logger.info(
      { inboxId: json.id, accountId: acctId, tenantName },
      "Chatwoot: inbox provisioned",
    );
    return {
      status: "created",
      inboxId: json.id,
      accountId: acctId,
      detail: `Inbox ${json.id} created in account ${acctId}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "Chatwoot: inbox provision failed");
    return {
      status: "failed",
      inboxId: null,
      accountId: acctId,
      detail: `Chatwoot exception: ${msg}`,
    };
  }
}

export async function postChatwootMessage(opts: {
  accountId: number;
  inboxId: number;
  contactPhone: string;
  body: string;
  messageType: "incoming" | "outgoing";
  private?: boolean;
}): Promise<ChatwootMessageResult> {
  const env = chatwootEnv();
  if (!env) {
    logger.info(
      {
        accountId: opts.accountId,
        inboxId: opts.inboxId,
        contactPhone: opts.contactPhone,
        messageType: opts.messageType,
        private: opts.private ?? false,
      },
      "Chatwoot: STUBBED (CHATWOOT_BASE_URL / CHATWOOT_API_ACCESS_TOKEN not set)",
    );
    return {
      status: "stubbed",
      conversationId: null,
      messageId: null,
      detail: "Stubbed: CHATWOOT_BASE_URL / CHATWOOT_API_ACCESS_TOKEN not set",
    };
  }

  try {
    const headers = {
      "content-type": "application/json",
      api_access_token: env.token,
    };
    const apiBase = `${env.base}/api/v1/accounts/${opts.accountId}`;

    // 1. find or create contact by phone number
    const contactSearch = await fetch(
      `${apiBase}/contacts/search?q=${encodeURIComponent(opts.contactPhone)}&include=contact_inboxes`,
      { headers },
    );
    let contactId: number | null = null;
    let sourceId: string | null = null;
    if (contactSearch.ok) {
      const json = (await contactSearch.json()) as {
        payload?: Array<{
          id: number;
          contact_inboxes?: Array<{ inbox?: { id?: number }; source_id?: string }>;
        }>;
      };
      const hit = json.payload?.[0];
      if (hit) {
        contactId = hit.id;
        sourceId =
          hit.contact_inboxes?.find((ci) => ci.inbox?.id === opts.inboxId)
            ?.source_id ?? null;
      }
    }
    if (!contactId) {
      const createContact = await fetch(`${apiBase}/contacts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          inbox_id: opts.inboxId,
          phone_number: opts.contactPhone,
          name: opts.contactPhone,
        }),
      });
      const json = (await createContact.json()) as {
        payload?: {
          contact?: { id?: number };
          contact_inbox?: { source_id?: string };
        };
      };
      contactId = json.payload?.contact?.id ?? null;
      sourceId = json.payload?.contact_inbox?.source_id ?? null;
      if (!contactId) {
        return {
          status: "failed",
          conversationId: null,
          messageId: null,
          detail: `Chatwoot contact create failed: ${createContact.status}`,
        };
      }
    }

    // 2. ensure conversation exists for that contact in the inbox
    let conversationId: number | null = null;
    const convList = await fetch(
      `${apiBase}/contacts/${contactId}/conversations`,
      { headers },
    );
    if (convList.ok) {
      const json = (await convList.json()) as {
        payload?: Array<{ id: number; inbox_id?: number; status?: string }>;
      };
      const open = json.payload?.find(
        (c) => c.inbox_id === opts.inboxId && c.status !== "resolved",
      );
      conversationId = open?.id ?? null;
    }
    if (!conversationId) {
      if (!sourceId) {
        return {
          status: "failed",
          conversationId: null,
          messageId: null,
          detail: "Chatwoot: missing source_id for inbox; cannot open conversation",
        };
      }
      const createConv = await fetch(`${apiBase}/conversations`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          source_id: sourceId,
          inbox_id: opts.inboxId,
          contact_id: contactId,
        }),
      });
      const json = (await createConv.json()) as { id?: number };
      conversationId = json.id ?? null;
      if (!conversationId) {
        return {
          status: "failed",
          conversationId: null,
          messageId: null,
          detail: `Chatwoot conversation create failed: ${createConv.status}`,
        };
      }
    }

    // 3. post the message
    const postMsg = await fetch(
      `${apiBase}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: opts.body,
          message_type: opts.messageType,
          private: opts.private ?? false,
        }),
      },
    );
    if (!postMsg.ok) {
      const text = await postMsg.text().catch(() => "");
      return {
        status: "failed",
        conversationId,
        messageId: null,
        detail: `Chatwoot message POST ${postMsg.status}: ${text.slice(0, 200)}`,
      };
    }
    const msgJson = (await postMsg.json()) as { id?: number };
    return {
      status: "sent",
      conversationId,
      messageId: msgJson.id ?? null,
      detail: `Chatwoot conv=${conversationId} msg=${msgJson.id ?? "?"}`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error({ err: detail }, "Chatwoot: request failed");
    return {
      status: "failed",
      conversationId: null,
      messageId: null,
      detail: `Chatwoot exception: ${detail}`,
    };
  }
}
