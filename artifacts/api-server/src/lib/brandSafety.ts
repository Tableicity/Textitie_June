import { rebrandText, containsCompetitor } from "@workspace/brand-safety";
import { logger } from "./logger";
import { recordBrandSafetyEvent } from "./brandSafetyStore";

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
 * When `ctx.tenantId` is a number, a catch (replacements > 0 OR residue) is also
 * persisted to the brand-safety leak feed (best-effort, fire-and-forget) so the
 * Conductor's per-tenant Brand Safety tab can surface it. `ctx.surface`
 * ("ai_reply" | "knowledge") and `ctx.site` (a short sub-site label) tag the row.
 *
 * @param opts.extraCompetitors per-tenant names layered on the base list, so a
 *   tenant-specific competitor is scrubbed (and detected) here too.
 *
 * Returns the scrubbed text. Use the pure `rebrandText` directly when you do not
 * want the log/feed (e.g. internal whisper notes).
 */
export function rebrandAndLog(
  input: string | null | undefined,
  ctx: Record<string, unknown>,
  opts?: { extraCompetitors?: string[] },
): string {
  const extra = opts?.extraCompetitors;
  const { text, replacements } = rebrandText(input, extra);
  const residue = containsCompetitor(text, extra);
  if (replacements > 0) {
    logger.warn(
      { ...ctx, replacements },
      "SAMA brand-safety: rewrote competitor name(s) in outbound/curated text",
    );
  }
  if (residue) {
    logger.error(
      { ...ctx },
      "SAMA brand-safety: competitor name STILL present after scrub (incomplete competitor list?)",
    );
  }
  if ((replacements > 0 || residue) && typeof ctx["tenantId"] === "number") {
    const surface =
      typeof ctx["surface"] === "string" ? ctx["surface"] : "unknown";
    const detail = typeof ctx["site"] === "string" ? ctx["site"] : null;
    // Fire-and-forget: the audit write must never block or break the caller.
    void recordBrandSafetyEvent({
      tenantId: ctx["tenantId"],
      surface,
      detail,
      replacements,
      residue,
    });
  }
  return text;
}
