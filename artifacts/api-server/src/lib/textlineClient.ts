/**
 * TextLine API client — the read-only extraction seam for the "TextLine Smasher"
 * migration. The Conductor supplies the tenant's own TextLine access token; we
 * use it ONLY to pull their data and never persist it in plaintext or log it.
 *
 * Mirrors the brainClient.ts philosophy: the exact TextLine wire contract is
 * EXTERNAL and not owned by this repo, so every request/response shape is
 * isolated here and parsed TOLERANTLY. The migration stages the RAW payloads
 * verbatim into migration_raw_data, so even if field names differ from the
 * assumptions below, no data is lost at extract time — only pagination detection
 * and id extraction need to be tolerant. If TextLine's real shape differs,
 * change ONLY this file.
 *
 * Assumed contract (adjust the endpoint table / key lists if the live API
 * differs):
 *   Base:    https://application.textline.com/
 *   Auth:    header  X-TGP-ACCESS-TOKEN: <token>
 *   List:    GET api/conversations?page=N        -> { conversations: [...] }
 *            GET api/agents                       -> { agents: [...] }
 *            GET api/groups                       -> { groups: [...] }
 *   Detail:  GET api/conversations/:uuid          -> { ..., comments: [...] }
 *   Paging:  page-number (1-based). We also stop on the first EMPTY page, so an
 *            unknown pagination scheme still terminates safely.
 */

const TEXTLINE_BASE_URL = "https://application.textline.com/";

// ~171 req/min — deliberate headroom under the 200/min ceiling (the architect
// asked for 350–400ms, not exactly 300). Process-wide single pacer is enough
// because the worker runs ONE migration at a time per process and TextLine
// limits are token/account-scoped.
const MIN_REQUEST_INTERVAL_MS = 350;
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_RETRY_AFTER_MS = 30_000;
const MAX_RETRY_AFTER_MS = 10 * 60_000;
const RETRY_JITTER_MS = 1_000;
const PER_PAGE = 100;

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Min-interval token bucket so we never exceed TextLine's per-minute ceiling. */
async function pace(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/** Raised on HTTP 429 so the worker can park the job until `retryAfterMs`. */
export class TextlineRateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("TextLine rate limited");
    this.name = "TextlineRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Raised on 401/403 — a bad/expired token is terminal (the operator must
 * restart with a fresh token); never retried. */
export class TextlineAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextlineAuthError";
  }
}

/** Any other transport / HTTP / parse failure. `status` is set for HTTP errors
 * so the worker can treat e.g. a 404 on an auxiliary entity as "no data". */
export class TextlineError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TextlineError";
    this.status = status;
  }
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Parse a Retry-After header (delta-seconds OR an HTTP-date), clamped + jittered. */
export function parseRetryAfterMs(header: string | null): number {
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  const trimmed = header.trim();
  const secs = Number(trimmed);
  let ms: number;
  if (Number.isFinite(secs)) {
    ms = Math.max(1, secs) * 1000;
  } else {
    const when = Date.parse(trimmed);
    ms = Number.isNaN(when) ? DEFAULT_RETRY_AFTER_MS : when - Date.now();
  }
  ms = Math.min(Math.max(ms, 1_000), MAX_RETRY_AFTER_MS);
  return ms + Math.floor(Math.random() * RETRY_JITTER_MS);
}

/**
 * Pull a single array out of a tolerant set of envelope shapes: a bare array,
 * or `{ <key>: [...] }` for any of the given keys, or `{ <key>: { items|data:
 * [...] } }`. Returns [] when nothing array-shaped is found.
 */
export function extractArray(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of keys) {
      const v = obj[key];
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object") {
        const nested = v as Record<string, unknown>;
        for (const nk of ["items", "data", "results"]) {
          if (Array.isArray(nested[nk])) return nested[nk] as unknown[];
        }
      }
    }
  }
  return [];
}

/**
 * Decide whether another page exists, tolerant of unknown pagination metadata.
 * An EMPTY page is the robust primary signal (always terminates). When a page
 * has records we honor explicit metadata if present, else assume "more" (the
 * caller caps total pages so this can never loop forever).
 */
export function detectHasMore(
  payload: unknown,
  page: number,
  recordCount: number,
): boolean {
  if (recordCount === 0) return false;
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    const meta =
      o["meta"] && typeof o["meta"] === "object"
        ? (o["meta"] as Record<string, unknown>)
        : o;
    const hasMore = meta["has_more"] ?? meta["hasMore"];
    if (typeof hasMore === "boolean") return hasMore;
    const totalPages =
      num(meta["total_pages"]) ?? num(meta["pages"]) ?? num(meta["page_count"]);
    if (totalPages != null) return page < totalPages;
    const nextPage = meta["next_page"] ?? meta["nextPage"];
    if (nextPage !== undefined) return Boolean(nextPage);
  }
  return true;
}

async function textlineGet(
  token: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<unknown> {
  await pace();
  const url = new URL(path, TEXTLINE_BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "X-TGP-ACCESS-TOKEN": token,
        accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TextlineError(`TextLine request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    throw new TextlineRateLimitedError(
      parseRetryAfterMs(res.headers.get("retry-after")),
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new TextlineAuthError(
      `TextLine rejected the access token (HTTP ${res.status})`,
    );
  }
  if (!res.ok) {
    throw new TextlineError(`TextLine responded with HTTP ${res.status}`, res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new TextlineError("TextLine returned a non-JSON payload");
  }
}

export interface TextlinePage {
  /** Verbatim API response for this page — staged as-is. */
  payload: unknown;
  /** Tolerantly-extracted records (for counts + has-more detection). */
  records: unknown[];
  hasMore: boolean;
}

interface ListEndpoint {
  path: string;
  keys: string[];
  /** Auxiliary single-shot lists (agents/groups) are fetched once, not paged. */
  paginated: boolean;
}

// ASSUMED endpoints — adjust here if the live TextLine API differs.
const LIST_ENDPOINTS: Record<string, ListEndpoint> = {
  agents: { path: "api/agents", keys: ["agents", "users"], paginated: false },
  groups: {
    path: "api/groups",
    keys: ["groups", "departments", "teams"],
    paginated: false,
  },
  conversations: {
    path: "api/conversations",
    keys: ["conversations", "items", "data"],
    paginated: true,
  },
};

export function isListEntity(entity: string): boolean {
  return entity in LIST_ENDPOINTS;
}

/** Fetch one page of a flat list entity (agents | groups | conversations). */
export async function fetchListPage(
  entity: string,
  token: string,
  page: number,
): Promise<TextlinePage> {
  const ep = LIST_ENDPOINTS[entity];
  if (!ep) throw new TextlineError(`Unknown list entity: ${entity}`);
  const payload = ep.paginated
    ? await textlineGet(token, ep.path, { page, per_page: PER_PAGE })
    : await textlineGet(token, ep.path);
  const records = extractArray(payload, ep.keys);
  const hasMore = ep.paginated ? detectHasMore(payload, page, records.length) : false;
  return { payload, records, hasMore };
}

/** Tolerantly pull the external ids out of a staged conversations page blob. */
export function extractConversationIds(pageBlob: unknown): string[] {
  const records = extractArray(pageBlob, LIST_ENDPOINTS.conversations.keys);
  const ids: string[] = [];
  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id =
      asString(o["uuid"]) ??
      asString(o["id"]) ??
      asString(o["external_id"]) ??
      asString(o["conversation_uuid"]) ??
      asString(o["address_book_id"]);
    if (id) ids.push(id);
  }
  return ids;
}

/** Fetch one conversation's full detail (messages/comments live inside). */
export async function fetchConversationDetail(
  token: string,
  conversationId: string,
): Promise<{ payload: unknown; postCount: number }> {
  const payload = await textlineGet(
    token,
    `api/conversations/${encodeURIComponent(conversationId)}`,
  );
  const posts = extractArray(payload, ["comments", "posts", "messages", "events"]);
  return { payload, postCount: posts.length };
}
