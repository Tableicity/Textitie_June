/**
 * Brain ("Beast") client — the outbound seam for the manual Admin knowledge
 * PULL. The Conductor triggers a harvest; Brain returns knowledge candidates
 * that are staged for human review and (once approved) flow into the SAME
 * absorbed-facts pool + Classroom push as Professor-curated facts.
 *
 * Mirrors the grokClient pattern: env-configured, and `brainConfigured()`
 * returns false when unset so the route can degrade with a clear 503 instead of
 * throwing. Treat everything Brain returns as UNTRUSTED external content — it is
 * staged as a draft and only ever published after explicit human approval +
 * Librarian adjudication.
 *
 * The exact Brain wire contract is external and not owned by this repo, so ALL
 * request/response shaping is isolated in `harvestFromBrain` below. The assumed
 * contract is:
 *   Request:  POST {BRAIN_BASE_URL}
 *             Authorization: Bearer {BRAIN_API_KEY}
 *             body: { tenantId, tenant: { id, name, slug }, limit }
 *   Response: { items: [ { title?, statement|text|content, category?, sourceUrl|url?, flagged?, flagReason? } ] }
 *             (a bare array, or { candidates|facts|data: [...] }, are also accepted)
 * If Brain's real shape differs, change ONLY this file.
 */

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_STATEMENT_CHARS = 2_000;
const MAX_TITLE_CHARS = 300;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface BrainCandidate {
  title: string;
  statement: string;
  /** Raw category label from Brain; normalized app-side by the route. */
  categoryRaw: string | null;
  sourceUrl: string | null;
  /** Non-null => candidate is "flagged" and renders unchecked for review. */
  flagReason: string | null;
}

export interface BrainHarvest {
  items: BrainCandidate[];
  /** Count of items Brain returned before local filtering/capping. */
  rawCount: number;
}

export function brainConfigured(): boolean {
  return Boolean(process.env["BRAIN_BASE_URL"] && process.env["BRAIN_API_KEY"]);
}

export class BrainNotConfiguredError extends Error {
  constructor() {
    super("Brain is not configured (set BRAIN_BASE_URL and BRAIN_API_KEY).");
    this.name = "BrainNotConfiguredError";
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickStatement(item: Record<string, unknown>): string | null {
  return (
    asString(item["statement"]) ??
    asString(item["text"]) ??
    asString(item["content"]) ??
    asString(item["fact"]) ??
    asString(item["body"])
  );
}

function pickSourceUrl(item: Record<string, unknown>): string | null {
  const url =
    asString(item["sourceUrl"]) ??
    asString(item["source_url"]) ??
    asString(item["url"]) ??
    asString(item["link"]);
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function pickFlagReason(item: Record<string, unknown>): string | null {
  const reason = asString(item["flagReason"]) ?? asString(item["flag_reason"]);
  if (reason) return reason;
  if (item["flagged"] === true) return "Flagged by Brain for manual review.";
  return null;
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["items", "candidates", "facts", "data", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

/**
 * Call Brain and return normalized, deduped-ready candidates. Throws
 * BrainNotConfiguredError when unconfigured and a plain Error on transport /
 * unusable-payload failures (the route maps these to 503 / 502). Never logs the
 * API key or the full payload.
 */
export async function harvestFromBrain(opts: {
  tenantId: number;
  tenantName: string;
  tenantSlug?: string | null;
  limit?: number;
}): Promise<BrainHarvest> {
  const baseUrl = process.env["BRAIN_BASE_URL"];
  const apiKey = process.env["BRAIN_API_KEY"];
  if (!baseUrl || !apiKey) throw new BrainNotConfiguredError();

  const limit = Math.min(
    Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT)),
    MAX_LIMIT,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        tenantId: opts.tenantId,
        tenant: {
          id: opts.tenantId,
          name: opts.tenantName,
          slug: opts.tenantSlug ?? null,
        },
        limit,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Brain request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Brain responded with HTTP ${res.status}`);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error("Brain returned a non-JSON payload");
  }

  const raw = extractItems(payload);
  const items: BrainCandidate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const statement = pickStatement(item);
    if (!statement) continue; // skip blanks — never stage empty candidates
    items.push({
      title:
        (asString(item["title"]) ??
          asString(item["name"]) ??
          asString(item["heading"]) ??
          "")
          .slice(0, MAX_TITLE_CHARS),
      statement: statement.slice(0, MAX_STATEMENT_CHARS),
      categoryRaw: asString(item["category"]) ?? asString(item["categoryRaw"]),
      sourceUrl: pickSourceUrl(item),
      flagReason: pickFlagReason(item),
    });
    if (items.length >= limit) break;
  }

  return { items, rawCount: raw.length };
}
