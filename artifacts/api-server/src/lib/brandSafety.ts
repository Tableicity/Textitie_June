import { rebrandText, containsCompetitor } from "@workspace/brand-safety";
import { logger } from "./logger";

export { rebrandText, containsCompetitor };

/**
 * Scrub competitor names from a piece of AI-generated or curated text and emit
 * a structured leak signal (Layer 4 of the brand-safety guardrails):
 *
 *   - replacements > 0  → a competitor name was caught and rewritten. This is
 *     the warning that surfaces dirty knowledge / a prompt that slipped, so the
 *     operator knows to clean ingestion at the source.
 *   - residue after scrub → the competitor list is incomplete; logged at error.
 *
 * Returns the scrubbed text. Use the pure `rebrandText` directly when you do not
 * want the log (e.g. internal whisper notes).
 */
export function rebrandAndLog(
  input: string | null | undefined,
  ctx: Record<string, unknown>,
): string {
  const { text, replacements } = rebrandText(input);
  if (replacements > 0) {
    logger.warn(
      { ...ctx, replacements },
      "SAMA brand-safety: rewrote competitor name(s) in outbound/curated text",
    );
  }
  if (containsCompetitor(text)) {
    logger.error(
      { ...ctx },
      "SAMA brand-safety: competitor name STILL present after scrub (incomplete SAMA_COMPETITOR_NAMES?)",
    );
  }
  return text;
}
