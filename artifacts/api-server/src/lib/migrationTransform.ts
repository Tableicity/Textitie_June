/**
 * TextLine Smasher — deterministic transform (Phase 3, P3.1).
 *
 * PURE: no DB, no I/O, no LLM. Turns a verbatim staged TextLine payload into the
 * normalized shapes the verify (summary) and hydrate (write) steps consume. The
 * TextLine wire contract is EXTERNAL/assumed, so — exactly like textlineClient —
 * every field is pulled from a TOLERANT set of candidate keys and nothing throws
 * on an unexpected shape; problems are recorded as anomalies instead.
 *
 * Invariants encoded here:
 *   - NO MMS: a message with no usable TEXT body (media-only) is dropped and
 *     counted as `skippedMms`; messages that have text keep only the text.
 *   - Every emitted record carries a STABLE importExternalId so re-running the
 *     migration upserts instead of duplicating (posts lacking an id get a stable
 *     synthetic `${convId}#${index}`).
 *   - Contacts dedupe by NORMALIZED PHONE, so the imported contact key is
 *     `phone:<normalizedPhone>` (customer ids that share a phone collapse into
 *     one contact; the collapse is reported in the summary).
 */

import { extractArray, asString } from "./textlineClient";

export type Direction = "inbound" | "outbound";

export interface NormalizedMessage {
  importExternalId: string;
  direction: Direction;
  body: string;
  senderName: string | null;
  createdAt: Date | null;
  deliveredAt: Date | null;
}

export interface NormalizedConversation {
  importExternalId: string;
  phone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactTags: string[];
  status: string;
  tags: string[];
  lastMessageAt: Date | null;
  createdAt: Date | null;
  messages: NormalizedMessage[];
  /** Media-only (MMS) messages dropped from this conversation. */
  skippedMms: number;
  anomalies: Anomaly[];
}

/**
 * A standalone address-book contact (from the TextLine `customers` list). Unlike
 * a conversation contact this may have NO conversation history — it is imported
 * purely so the tenant keeps their full contact list + tags. Dedupe key is the
 * normalized phone (`phone:<normalizedPhone>`), the same key conversation hydrate
 * uses, so a customer that ALSO has a conversation collapses onto one contact.
 */
export interface NormalizedContact {
  externalId: string | null;
  phone: string | null;
  name: string | null;
  email: string | null;
  tags: string[];
  anomalies: Anomaly[];
}

export interface Anomaly {
  type: string;
  /** A non-PII external-id reference, never a message body. */
  ref: string | null;
  detail: string;
}

export type AgentMap = Map<string, { name: string | null; email: string | null }>;

const MAX_ANOMALIES = 200;

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** First non-null string among a record's candidate keys. */
function pick(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = asString(o[k]);
    if (v) return v;
  }
  return null;
}

/**
 * Canonicalize a phone for dedupe: keep a single leading '+' (if present) and
 * digits only. Country code is NOT inferred (we never guess), so dedupe is exact
 * on whatever TextLine stored. Returns null when nothing dial-able remains.
 */
export function normalizePhone(raw: unknown): string | null {
  const s = asString(raw);
  if (!s) return null;
  const hasPlus = s.trim().startsWith("+");
  const digits = s.replace(/[^0-9]/g, "");
  if (!digits) return null;
  return (hasPlus ? "+" : "") + digits;
}

/** Tolerant date parse: ISO/RFC strings, or epoch seconds/millis. Null on junk. */
export function parseDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Heuristic: 10-digit values are epoch seconds, 13-digit are millis.
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = asString(raw);
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n) && /^[0-9]+$/.test(s)) {
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Pull tags out of `["a","b"]` or `[{name:"a"}]` / `[{tag:"a"}]` shapes. */
function extractTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const t of value) {
    const s =
      asString(t) ??
      (obj(t) ? pick(obj(t) as Record<string, unknown>, ["name", "tag", "label", "title"]) : null);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

const AGENT_AUTHOR_TYPES = new Set([
  "agent",
  "operator",
  "user",
  "staff",
  "admin",
  "member",
  "team",
]);
const CUSTOMER_AUTHOR_TYPES = new Set([
  "customer",
  "contact",
  "client",
  "visitor",
  "lead",
  "person",
]);

/** Build the agent lookup (external id -> name/email) used for outbound sender
 * attribution. Keyed by every id-ish field so a comment's author id resolves. */
export function buildAgentMap(agentsPayload: unknown): AgentMap {
  const map: AgentMap = new Map();
  const records = extractArray(agentsPayload, ["agents", "users", "members", "items", "data"]);
  for (const r of records) {
    const o = obj(r);
    if (!o) continue;
    const name =
      pick(o, ["name", "full_name", "display_name", "username"]) ??
      ([pick(o, ["first_name"]), pick(o, ["last_name"])].filter(Boolean).join(" ").trim() || null);
    const email = pick(o, ["email", "email_address"]);
    const ids = [
      asString(o["id"]),
      asString(o["uuid"]),
      asString(o["agent_id"]),
      asString(o["user_id"]),
      email,
    ].filter((v): v is string => Boolean(v));
    for (const id of ids) {
      if (!map.has(id)) map.set(id, { name: name || null, email });
    }
  }
  return map;
}

/**
 * Decide a comment's direction. Explicit direction wins; otherwise infer from the
 * author type / presence of an agent id. Returns the direction and whether it was
 * a confident decision (an unconfident guess is flagged as an anomaly upstream).
 */
export function deriveDirection(
  comment: Record<string, unknown>,
  agentMap: AgentMap,
): { direction: Direction; confident: boolean; agentId: string | null } {
  const explicit = (
    pick(comment, ["direction", "kind", "type", "message_type"]) ?? ""
  ).toLowerCase();
  if (explicit === "inbound" || explicit === "incoming" || explicit === "received") {
    return { direction: "inbound", confident: true, agentId: null };
  }
  if (
    explicit === "outbound" ||
    explicit === "outgoing" ||
    explicit === "sent" ||
    explicit === "reply"
  ) {
    return { direction: "outbound", confident: true, agentId: agentIdOf(comment) };
  }

  const incoming = comment["incoming"] ?? comment["is_incoming"] ?? comment["inbound"];
  if (typeof incoming === "boolean") {
    return incoming
      ? { direction: "inbound", confident: true, agentId: null }
      : { direction: "outbound", confident: true, agentId: agentIdOf(comment) };
  }

  const authorType = (
    pick(comment, ["author_type", "sender_type", "from_type", "role"]) ?? ""
  ).toLowerCase();
  if (AGENT_AUTHOR_TYPES.has(authorType)) {
    return { direction: "outbound", confident: true, agentId: agentIdOf(comment) };
  }
  if (CUSTOMER_AUTHOR_TYPES.has(authorType)) {
    return { direction: "inbound", confident: true, agentId: null };
  }

  const agentId = agentIdOf(comment);
  if (agentId && agentMap.has(agentId)) {
    return { direction: "outbound", confident: true, agentId };
  }

  // No usable signal: assume the customer spoke (inbound) but flag it.
  return { direction: "inbound", confident: false, agentId: null };
}

function agentIdOf(comment: Record<string, unknown>): string | null {
  return (
    asString(comment["agent_id"]) ??
    asString(comment["user_id"]) ??
    asString(comment["operator_id"]) ??
    asString(comment["sender_id"]) ??
    (obj(comment["agent"]) ? asString((obj(comment["agent"]) as Record<string, unknown>)["id"]) : null) ??
    (obj(comment["user"]) ? asString((obj(comment["user"]) as Record<string, unknown>)["id"]) : null)
  );
}

/** Extract the TEXT body of a comment. Null => media-only (MMS) / empty. */
export function extractBody(comment: Record<string, unknown>): string | null {
  return pick(comment, ["body", "text", "message", "content", "comment", "html_body"]);
}

function resolveSenderName(
  comment: Record<string, unknown>,
  direction: Direction,
  agentId: string | null,
  agentMap: AgentMap,
  customerName: string | null,
): string | null {
  if (direction === "inbound") {
    return (
      pick(comment, ["author_name", "sender_name", "from_name", "customer_name"]) ??
      customerName
    );
  }
  if (agentId && agentMap.has(agentId)) {
    const a = agentMap.get(agentId)!;
    if (a.name) return a.name;
  }
  return pick(comment, ["author_name", "sender_name", "agent_name", "from_name"]);
}

function extractCustomer(detail: Record<string, unknown>): {
  externalId: string | null;
  phone: string | null;
  name: string | null;
  email: string | null;
  tags: string[];
} {
  const cust =
    obj(detail["customer"]) ??
    obj(detail["contact"]) ??
    obj(detail["address_book"]) ??
    obj(detail["address_book_contact"]) ??
    obj(detail["person"]) ??
    detail;
  const c = cust as Record<string, unknown>;
  const phone = normalizePhone(
    c["phone_number"] ?? c["phone"] ?? c["number"] ?? c["e164"] ?? c["msisdn"] ??
      detail["phone_number"] ?? detail["phone"],
  );
  const name =
    pick(c, ["name", "full_name", "display_name"]) ??
    ([pick(c, ["first_name"]), pick(c, ["last_name"])].filter(Boolean).join(" ").trim() || null);
  const email = pick(c, ["email", "email_address"]);
  const externalId =
    asString(c["uuid"]) ?? asString(c["id"]) ?? asString(c["customer_id"]) ?? asString(c["address_book_id"]);
  const tags = extractTags(c["tags"] ?? c["labels"]);
  return { externalId, phone, name, email, tags };
}

function mapStatus(raw: string | null): string {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("close") || s.includes("resolve") || s.includes("done") || s.includes("archiv")) {
    return "closed";
  }
  return "open";
}

/**
 * Transform ONE staged conversation detail payload into a normalized conversation
 * with its (text-only) messages, threaded by created_at. Never throws.
 */
export function transformConversationDetail(
  payload: unknown,
  agentMap: AgentMap,
): NormalizedConversation {
  const anomalies: Anomaly[] = [];
  const detail = obj(payload) ?? {};
  const convId =
    asString(detail["uuid"]) ??
    asString(detail["id"]) ??
    asString(detail["external_id"]) ??
    asString(detail["conversation_uuid"]) ??
    `conv-unknown`;

  const customer = extractCustomer(detail);
  if (!customer.phone) {
    anomalies.push({
      type: "conversation_missing_phone",
      ref: convId,
      detail: "Conversation has no extractable customer phone number.",
    });
  }

  const rawComments = extractArray(detail, ["comments", "posts", "messages", "events"]);
  const messages: NormalizedMessage[] = [];
  let skippedMms = 0;
  let index = 0;

  for (const rc of rawComments) {
    const c = obj(rc);
    index += 1;
    if (!c) continue;
    const body = extractBody(c);
    if (!body) {
      // Media-only / empty (MMS) — explicitly excluded from the import.
      skippedMms += 1;
      continue;
    }
    const { direction, confident, agentId } = deriveDirection(c, agentMap);
    if (!confident && anomalies.length < MAX_ANOMALIES) {
      anomalies.push({
        type: "message_direction_guessed",
        ref: `${convId}#${index}`,
        detail: "Could not determine message direction; defaulted to inbound.",
      });
    }
    const importExternalId =
      asString(c["uuid"]) ?? asString(c["id"]) ?? asString(c["external_id"]) ?? `${convId}#${index}`;
    messages.push({
      importExternalId,
      direction,
      body,
      senderName: resolveSenderName(c, direction, agentId, agentMap, customer.name),
      createdAt: parseDate(c["created_at"] ?? c["inserted_at"] ?? c["timestamp"] ?? c["date"] ?? c["sent_at"]),
      deliveredAt: parseDate(c["delivered_at"] ?? c["sent_at"] ?? c["created_at"]),
    });
  }

  // Thread rebuild: oldest first; undated messages sink to the end stably.
  messages.sort((a, b) => {
    const ta = a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });

  const lastMessageAt = messages.reduce<Date | null>((acc, m) => {
    if (m.createdAt && (!acc || m.createdAt > acc)) return m.createdAt;
    return acc;
  }, null);

  return {
    importExternalId: convId,
    phone: customer.phone,
    contactName: customer.name,
    contactEmail: customer.email,
    contactTags: customer.tags,
    status: mapStatus(pick(detail, ["status", "state"])),
    tags: extractTags(detail["tags"] ?? detail["labels"]),
    lastMessageAt:
      lastMessageAt ?? parseDate(detail["last_message_at"] ?? detail["updated_at"]),
    createdAt: parseDate(detail["created_at"] ?? detail["inserted_at"]),
    messages,
    skippedMms,
    anomalies,
  };
}

/**
 * Transform ONE staged address-book (customers) page payload into normalized
 * standalone contacts. PURE + tolerant: each record is run through the same
 * extractCustomer() seam used for conversation contacts, so the wire-shape
 * assumptions live in exactly one place. A record with no extractable phone is
 * still emitted (carrying a non-PII anomaly) so verify can count it; hydrate
 * drops it (the contacts.phone column is NOT NULL). Never throws.
 */
export function transformCustomersPage(payload: unknown): NormalizedContact[] {
  const records = extractArray(payload, [
    "customers",
    "contacts",
    "address_book",
    "people",
    "items",
    "data",
  ]);
  const out: NormalizedContact[] = [];
  for (const r of records) {
    const o = obj(r);
    if (!o) continue;
    const c = extractCustomer(o);
    const anomalies: Anomaly[] = [];
    if (!c.phone) {
      anomalies.push({
        type: "customer_missing_phone",
        ref: c.externalId,
        detail: "Address-book contact has no extractable phone number; not imported.",
      });
    }
    out.push({
      externalId: c.externalId,
      phone: c.phone,
      name: c.name,
      email: c.email,
      tags: c.tags,
      anomalies,
    });
  }
  return out;
}

// --- Verify summary -----------------------------------------------------------

export interface MigrationSummary {
  conversations: { imported: number; flagged: number };
  messages: { imported: number; skippedMms: number };
  contacts: {
    uniquePhones: number;
    aliasCollapsed: number;
    missingPhone: number;
    /** Total address-book records seen (with or without a phone). */
    addressBook: number;
    /** Address-book contacts that introduced a NEW phone (no conversation). */
    standalone: number;
    /** Address-book records with no extractable phone (cannot be imported). */
    addressBookMissingPhone: number;
    /** Address-book records whose phone was already seen (collapsed). */
    addressBookDuplicate: number;
  };
  anomalies: Anomaly[];
  anomalyCount: number;
  generatedAt: string;
  flippedAt?: string;
}

/**
 * Mutable accumulator for the streaming verify pass. Holds the seen-phone set in
 * MEMORY only (never persisted) so a multi-year migration's summary stays bounded
 * and re-deriving on crash is safe.
 */
export interface SummaryAccumulator {
  conversations: number;
  flaggedConversations: number;
  messages: number;
  skippedMms: number;
  phones: Set<string>;
  /** distinct (phone) already counted -> how many extra contacts collapsed in. */
  aliasCollapsed: number;
  missingPhone: number;
  /** Total address-book (customers) records folded. */
  addressBook: number;
  /** Address-book contacts whose phone was NEW (no conversation owned it). */
  standalone: number;
  /** Address-book records with no extractable phone. */
  addressBookMissingPhone: number;
  /** Address-book records whose phone was already seen (collapsed, not new). */
  addressBookDuplicate: number;
  anomalies: Anomaly[];
  anomalyCount: number;
}

export function newSummaryAccumulator(): SummaryAccumulator {
  return {
    conversations: 0,
    flaggedConversations: 0,
    messages: 0,
    skippedMms: 0,
    phones: new Set<string>(),
    aliasCollapsed: 0,
    missingPhone: 0,
    addressBook: 0,
    standalone: 0,
    addressBookMissingPhone: 0,
    addressBookDuplicate: 0,
    anomalies: [],
    anomalyCount: 0,
  };
}

/** Fold one transformed conversation into the running verify summary. */
export function foldIntoSummary(
  acc: SummaryAccumulator,
  conv: NormalizedConversation,
): void {
  acc.conversations += 1;
  acc.messages += conv.messages.length;
  acc.skippedMms += conv.skippedMms;
  if (conv.phone) {
    if (acc.phones.has(conv.phone)) acc.aliasCollapsed += 1;
    else acc.phones.add(conv.phone);
  } else {
    acc.flaggedConversations += 1;
    acc.missingPhone += 1;
  }
  for (const a of conv.anomalies) {
    acc.anomalyCount += 1;
    if (acc.anomalies.length < MAX_ANOMALIES) acc.anomalies.push(a);
  }
}

/**
 * Fold one transformed address-book contact into the running verify summary.
 * MUST be called AFTER every conversation is folded so a contact's phone is only
 * counted as `standalone` (a contact with NO conversation history) when no
 * conversation already introduced it. Shares the same `phones` Set as
 * conversations so uniquePhones stays a true global distinct-phone count.
 */
export function foldContactIntoSummary(
  acc: SummaryAccumulator,
  contact: NormalizedContact,
): void {
  acc.addressBook += 1;
  if (!contact.phone) {
    acc.addressBookMissingPhone += 1;
  } else if (acc.phones.has(contact.phone)) {
    acc.addressBookDuplicate += 1;
  } else {
    acc.phones.add(contact.phone);
    acc.standalone += 1;
  }
  for (const a of contact.anomalies) {
    acc.anomalyCount += 1;
    if (acc.anomalies.length < MAX_ANOMALIES) acc.anomalies.push(a);
  }
}

export function finalizeSummary(acc: SummaryAccumulator): MigrationSummary {
  return {
    conversations: { imported: acc.conversations, flagged: acc.flaggedConversations },
    messages: { imported: acc.messages, skippedMms: acc.skippedMms },
    contacts: {
      uniquePhones: acc.phones.size,
      aliasCollapsed: acc.aliasCollapsed,
      missingPhone: acc.missingPhone,
      addressBook: acc.addressBook,
      standalone: acc.standalone,
      addressBookMissingPhone: acc.addressBookMissingPhone,
      addressBookDuplicate: acc.addressBookDuplicate,
    },
    anomalies: acc.anomalies,
    anomalyCount: acc.anomalyCount,
    generatedAt: new Date().toISOString(),
  };
}
