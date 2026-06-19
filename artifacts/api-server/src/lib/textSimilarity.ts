/**
 * Pure text-similarity helpers shared by the Librarian (push-time dedup) and the
 * Professor escalation persistence path (live-learning dedup). Extracted into a
 * dependency-free module so both `librarian.ts` and `knowledge.ts` can import it
 * without a circular dependency (librarian already imports knowledge).
 */

/** pg_trgm-style trigram set: lowercased, non-alphanumerics collapsed, padded. */
export function trigrams(input: string): Set<string> {
  const norm =
    "  " + input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  const set = new Set<string>();
  for (let i = 0; i + 3 <= norm.length; i++) set.add(norm.slice(i, i + 3));
  return set;
}

/** Jaccard similarity of two trigram sets (0..1). */
export function trigramSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
