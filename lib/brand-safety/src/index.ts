/**
 * SAMA brand-safety scrub.
 *
 * A deterministic, last-line-of-defense rewrite of competitor product names to
 * the canonical brand. The LLM prompts are ASKED to never name a competitor,
 * but a prompt can be ignored; this pure function GUARANTEES no configured
 * competitor name survives in any text it is run over (AI-generated customer
 * replies, Co-Pilot drafts, and curated knowledge before it becomes
 * groundable).
 *
 * Pure (no I/O, no logging) so it can be shared by the API server and one-off
 * scripts. The server wraps it with structured leak logging in
 * `artifacts/api-server/src/lib/brandSafety.ts`.
 *
 * Config:
 *   - SAMA_BRAND_NAME       canonical brand (default "Textitie"), read live from
 *                           the environment. Platform-wide.
 *   - SAMA_COMPETITOR_NAMES comma-separated PLATFORM-BASE names to rewrite
 *                           (default "TextLine,TextLines"). Matching is
 *                           case-insensitive, so a single "TextLine" entry
 *                           already covers "textline", "TEXTLINE", etc.
 *   - extraCompetitors      optional PER-TENANT names layered on top of the base
 *                           list, passed by the caller (e.g. a tenant that
 *                           migrated from a different competitor). Merged with
 *                           the base list, deduped case-insensitively.
 */

const DEFAULT_BRAND = "Textitie";
// One-word brand only — case-insensitive matching covers every casing, and the
// plural. The two-word "Text Line" is deliberately NOT a default: "text line"
// is a common English phrase and would cause false positives.
const DEFAULT_COMPETITORS = ["TextLine", "TextLines"];

export function brandName(): string {
  const v = process.env["SAMA_BRAND_NAME"]?.trim();
  return v && v.length > 0 ? v : DEFAULT_BRAND;
}

/**
 * Parse a comma-separated competitor list into a trimmed, non-empty string
 * array. Shared by the env reader and the per-tenant CSV column reader so both
 * normalize identically. Safe on null/undefined.
 */
export function parseCompetitorNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function competitorNames(): string[] {
  const list = parseCompetitorNames(process.env["SAMA_COMPETITOR_NAMES"]);
  return list.length > 0 ? list : DEFAULT_COMPETITORS;
}

/**
 * Merge the platform-base competitor list with optional per-tenant extras,
 * deduped case-insensitively (the base wins on a casing tie).
 */
function mergeCompetitors(extra?: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of [...competitorNames(), ...(extra ?? [])]) {
    const trimmed = name.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a fresh word-boundaried, case-insensitive, global alternation regex.
 * Returns a NEW RegExp each call (so the stateful `lastIndex` is never shared
 * between `rebrandText` and `containsCompetitor`) and null when there are no
 * competitor names configured.
 */
function buildPattern(extra?: string[]): RegExp | null {
  const names = mergeCompetitors(extra)
    // Longest-first so a more specific variant (e.g. "TextLines") is tried
    // before a prefix of it ("TextLine") at the same position.
    .sort((a, b) => b.length - a.length)
    // Escape regex metachars, then allow flexible whitespace inside multi-word
    // names so "Foo  Bar" still matches "Foo Bar".
    .map((n) => escapeRegex(n).replace(/\s+/g, "\\s+"));
  if (names.length === 0) return null;
  return new RegExp(`\\b(?:${names.join("|")})\\b`, "gi");
}

/**
 * Rewrite every configured competitor name in `input` to the canonical brand.
 * Word-boundaried and case-insensitive; the trailing possessive/punctuation is
 * preserved ("TextLine's" → "Textitie's"). Idempotent. Safe on null/undefined.
 *
 * @param extraCompetitors optional per-tenant names layered on the base list.
 * @returns the rewritten text and the number of substitutions made (0 = clean).
 */
export function rebrandText(
  input: string | null | undefined,
  extraCompetitors?: string[],
): {
  text: string;
  replacements: number;
} {
  const original = input ?? "";
  if (original.length === 0) return { text: original, replacements: 0 };
  const pattern = buildPattern(extraCompetitors);
  if (!pattern) return { text: original, replacements: 0 };
  const brand = brandName();
  let replacements = 0;
  const text = original.replace(pattern, () => {
    replacements += 1;
    return brand;
  });
  return { text, replacements };
}

/** True if `input` still contains a configured competitor name. */
export function containsCompetitor(
  input: string | null | undefined,
  extraCompetitors?: string[],
): boolean {
  const text = input ?? "";
  if (text.length === 0) return false;
  const pattern = buildPattern(extraCompetitors);
  if (!pattern) return false;
  return pattern.test(text);
}
