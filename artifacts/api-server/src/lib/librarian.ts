import { grokClient, PROFESSOR_MODEL } from "./grokClient";
import { normalizeCategory, type FactCategory } from "./knowledge";
import { logger } from "./logger";

/**
 * The Librarian — push-time knowledge hygiene.
 *
 * Before a curated set of accepted facts becomes a published Classroom version,
 * the Librarian collapses near-duplicates / refinements into a single fact and
 * FLAGS genuine contradictions instead of silently picking a winner. The
 * conflict gate matters most for `pricing` and `compliance`, where a wrong auto
 * merge would let the Student quote a stale price or an unsafe policy.
 *
 * Two stages:
 *  1. Cheap candidate detection — trigram (pg_trgm-style) Jaccard similarity,
 *     computed in-process over the already-loaded fact set. No DB extension is
 *     required and nothing leaves the request until a real candidate is found.
 *  2. Grok adjudication — only candidate CLUSTERS (2+ similar facts) are sent to
 *     the Professor model to decide merge / conflict / distinct.
 *
 * When Grok is unconfigured or errors, the Librarian degrades to a pass-through:
 * every fact publishes as-is (the pre-Librarian behavior). It never drops a fact
 * and never false-merges on failure.
 */

export interface LibrarianFact {
  id: number;
  statement: string;
  category: string;
  sourceLabel: string;
  tokenCount: number;
}

/** A fact destined for the Classroom snapshot (passthrough or merged). */
export interface PublishFact {
  statement: string;
  category: string;
  sourceLabel: string;
  tokenCount: number;
}

/** An absorbed fact the Librarian wants flagged as a conflict for the Conductor. */
export interface ConflictMark {
  id: number;
  reason: string;
}

export interface LibrarianResult {
  /** Deduped/merged + passthrough facts to write into the new Classroom version. */
  publish: PublishFact[];
  /** Absorbed-fact ids to mark status="conflict" (excluded from the snapshot). */
  conflicts: ConflictMark[];
  /** How many source facts were collapsed away by merges (for the response/UI). */
  mergedCount: number;
  /** How many facts were flagged as conflicting. */
  conflictCount: number;
}

export type ClusterDecision =
  | { decision: "merge"; mergedStatement: string; category: string }
  | { decision: "conflict"; reason: string }
  | { decision: "distinct" };

export type ClusterAdjudicator = (
  facts: LibrarianFact[],
) => Promise<ClusterDecision>;

export interface LibrarianOptions {
  /** Jaccard threshold for two facts to be candidate near-dupes. */
  threshold?: number;
  /**
   * Lower threshold applied only within the same high-stakes category
   * (pricing/compliance) so subtly-worded contradictions still get adjudicated.
   */
  sensitiveThreshold?: number;
  /** Hard cap on clusters sent to Grok per push (cost/latency guard). */
  maxClusters?: number;
}

const DEFAULTS: Required<LibrarianOptions> = {
  threshold: 0.3,
  sensitiveThreshold: 0.18,
  maxClusters: 40,
};

const SENSITIVE_CATEGORIES = new Set<FactCategory>(["pricing", "compliance"]);

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests).
// ---------------------------------------------------------------------------

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

// Generic words that carry no subject identity in a pricing/compliance fact —
// excluded so facts aren't clustered just because they both say "plan"/"price".
const SUBJECT_STOPWORDS = new Set([
  "the", "and", "for", "with", "plan", "plans", "per", "month", "months",
  "year", "years", "our", "you", "your", "are", "can", "will", "that", "this",
  "each", "also", "only", "when", "from", "into", "not", "has", "have", "does",
  "day", "days", "fee", "fees", "cost", "costs", "price", "prices", "priced",
  "pricing", "rate", "rates", "charge", "charged", "billed", "billing",
]);

/**
 * Salient subject tokens — lowercased words ≥3 chars minus generic filler. Plan
 * names ("pro", "starter", "enterprise") and compliance terms ("hipaa", "tcpa")
 * survive so two facts about the SAME subject can be matched on identity even
 * when their wording (and thus trigram overlap) diverges.
 */
export function salientTokens(input: string): Set<string> {
  const set = new Set<string>();
  for (const w of input.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []) {
    if (!SUBJECT_STOPWORDS.has(w)) set.add(w);
  }
  return set;
}

/** Numeric/currency values in a statement, normalized to bare number strings. */
export function numericTokens(input: string): Set<string> {
  const set = new Set<string>();
  for (const m of input.match(/\d+(?:\.\d+)?/g) ?? []) set.add(m);
  return set;
}

function shareAny(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/** True when both sets are non-empty AND not identical (a value differs). */
function setsDiffer(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  if (a.size !== b.size) return true;
  for (const x of a) if (!b.has(x)) return true;
  return false;
}

/**
 * Group facts into clusters of likely near-duplicates via union-find over
 * candidate pairs. Facts with no candidate partner come back as singletons.
 */
export function clusterFacts(
  facts: LibrarianFact[],
  opts: LibrarianOptions = {},
): LibrarianFact[][] {
  const { threshold, sensitiveThreshold } = { ...DEFAULTS, ...opts };
  const n = facts.length;
  const parent = facts.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[x] !== r) {
      const next = parent[x]!;
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const tris = facts.map((f) => trigrams(f.statement));
  const cats = facts.map((f) => normalizeCategory(f.category));
  const salients = facts.map((f) => salientTokens(f.statement));
  const numerics = facts.map((f) => numericTokens(f.statement));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sameSensitive =
        cats[i] === cats[j] && SENSITIVE_CATEGORIES.has(cats[i]!);
      const limit = sameSensitive ? sensitiveThreshold : threshold;
      if (trigramSimilarity(tris[i]!, tris[j]!) >= limit) {
        union(i, j);
        continue;
      }
      // High-stakes fallback: two same-sensitive-category facts about the same
      // subject (shared salient token) whose numeric values DIFFER are very
      // likely a contradiction even at low textual overlap — send them to Grok.
      if (
        sameSensitive &&
        shareAny(salients[i]!, salients[j]!) &&
        setsDiffer(numerics[i]!, numerics[j]!)
      ) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, LibrarianFact[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root) ?? [];
    g.push(facts[i]!);
    groups.set(root, g);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Grok adjudication.
// ---------------------------------------------------------------------------

const ADJUDICATOR_SYSTEM = `You are the Librarian for a customer-support knowledge base. You are given a small CLUSTER of candidate-duplicate facts that are already textually similar. Choose EXACTLY ONE decision for the whole cluster:
- "merge": every fact states the same thing, possibly with one refining or extending another, with NO contradiction. Produce a single merged statement that preserves every specific detail (numbers, names, conditions).
- "conflict": two or more facts contradict each other — different prices, dates, numbers, eligibility, or mutually exclusive claims. Do NOT merge.
- "distinct": the facts are actually about different things (the similarity was a false positive). Keep them separate.

Rules:
- Be conservative. If the cluster category is "pricing" or "compliance" and ANY value, number, or condition differs between facts, choose "conflict", never "merge".
- Never invent facts not present in the inputs.

Respond with ONLY a JSON object, no prose:
{"decision":"merge","mergedStatement":"...","category":"pricing|compliance|features|technical_setup|general"}
or {"decision":"conflict","reason":"short explanation of the contradiction"}
or {"decision":"distinct"}`;

function stripJsonFence(text: string): string {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const brace = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (brace >= 0 && end > brace) return t.slice(brace, end + 1);
  return t;
}

function parseDecision(raw: string): ClusterDecision {
  const parsed = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>;
  const decision = String(parsed["decision"] ?? "").toLowerCase();
  if (decision === "merge") {
    const statement = String(parsed["mergedStatement"] ?? "").trim();
    if (!statement) throw new Error("merge decision missing mergedStatement");
    return {
      decision: "merge",
      mergedStatement: statement,
      category: normalizeCategory(parsed["category"]),
    };
  }
  if (decision === "conflict") {
    return {
      decision: "conflict",
      reason: String(parsed["reason"] ?? "Contradiction detected").trim(),
    };
  }
  return { decision: "distinct" };
}

/** Default adjudicator backed by the Professor (Grok) model. */
export const grokAdjudicateCluster: ClusterAdjudicator = async (facts) => {
  const client = grokClient();
  if (!client) return { decision: "distinct" };
  const category = normalizeCategory(facts[0]?.category);
  const list = facts
    .map((f, i) => `${i + 1}. [${normalizeCategory(f.category)}] ${f.statement}`)
    .join("\n");
  const completion = await client.chat.completions.create({
    model: PROFESSOR_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: ADJUDICATOR_SYSTEM },
      {
        role: "user",
        content: `Cluster category: ${category}\nFacts:\n${list}`,
      },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "";
  return parseDecision(raw);
};

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

function mergedTokenCount(members: LibrarianFact[], statement: string): number {
  // Rough token estimate (~4 chars/token), floored at the largest member so a
  // merge never under-counts the budget versus its sources.
  const est = Math.ceil(statement.length / 4);
  const maxMember = members.reduce((m, f) => Math.max(m, f.tokenCount ?? 0), 0);
  return Math.max(est, maxMember);
}

/**
 * Adjudicate a set of accepted facts ahead of a Classroom push. Pure with
 * respect to the database — the caller applies `publish` / `conflicts` inside
 * the push transaction. `adjudicator` is injectable for tests.
 */
export async function adjudicateForPush(
  facts: LibrarianFact[],
  adjudicator: ClusterAdjudicator = grokAdjudicateCluster,
  options: LibrarianOptions = {},
): Promise<LibrarianResult> {
  const passthrough = (): LibrarianResult => ({
    publish: facts.map((f) => ({
      statement: f.statement,
      category: normalizeCategory(f.category),
      sourceLabel: f.sourceLabel,
      tokenCount: f.tokenCount ?? 0,
    })),
    conflicts: [],
    mergedCount: 0,
    conflictCount: 0,
  });

  if (facts.length <= 1 || !grokClient()) return passthrough();

  const opts = { ...DEFAULTS, ...options };
  const clusters = clusterFacts(facts, opts);

  const publish: PublishFact[] = [];
  const conflicts: ConflictMark[] = [];
  let mergedCount = 0;
  let conflictCount = 0;
  let adjudicated = 0;

  for (const cluster of clusters) {
    if (cluster.length === 1) {
      const f = cluster[0]!;
      publish.push({
        statement: f.statement,
        category: normalizeCategory(f.category),
        sourceLabel: f.sourceLabel,
        tokenCount: f.tokenCount ?? 0,
      });
      continue;
    }

    // Over the per-push cap: pass the cluster through unmerged rather than
    // spend more Grok calls. Safe — same as today's behavior.
    if (adjudicated >= opts.maxClusters) {
      for (const f of cluster) {
        publish.push({
          statement: f.statement,
          category: normalizeCategory(f.category),
          sourceLabel: f.sourceLabel,
          tokenCount: f.tokenCount ?? 0,
        });
      }
      continue;
    }

    adjudicated++;
    let decision: ClusterDecision;
    try {
      decision = await adjudicator(cluster);
    } catch (err) {
      // Fail open: publish all members untouched (never lose a fact, never
      // false-merge on an LLM error).
      logger.error(
        { err, factIds: cluster.map((f) => f.id) },
        "Librarian adjudication failed; passing cluster through",
      );
      decision = { decision: "distinct" };
    }

    if (decision.decision === "merge") {
      mergedCount += cluster.length - 1;
      publish.push({
        statement: decision.mergedStatement,
        category: normalizeCategory(decision.category),
        sourceLabel:
          cluster.length > 1
            ? `Merged (${cluster.length} sources)`
            : cluster[0]!.sourceLabel,
        tokenCount: mergedTokenCount(cluster, decision.mergedStatement),
      });
    } else if (decision.decision === "conflict") {
      conflictCount += cluster.length;
      const others = cluster
        .map((f) => `“${f.statement}”`)
        .join(" vs ");
      for (const f of cluster) {
        conflicts.push({
          id: f.id,
          reason: `${decision.reason} (${others})`.slice(0, 1000),
        });
      }
    } else {
      for (const f of cluster) {
        publish.push({
          statement: f.statement,
          category: normalizeCategory(f.category),
          sourceLabel: f.sourceLabel,
          tokenCount: f.tokenCount ?? 0,
        });
      }
    }
  }

  return { publish, conflicts, mergedCount, conflictCount };
}
