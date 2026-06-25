import { describe, expect, it, vi } from "vitest";

// Make professorClient() truthy so adjudicateForPush runs its clustering path
// regardless of whether provider creds are set in the test env. The real LLM is
// never called — every test injects its own deterministic adjudicator.
vi.mock("./grokClient", () => ({
  professorClient: () => ({}),
  PROFESSOR_MODEL: "test-model",
}));

const {
  trigrams,
  trigramSimilarity,
  clusterFacts,
  adjudicateForPush,
  salientTokens,
  numericTokens,
} = await import("./librarian");
import type {
  LibrarianFact,
  ClusterAdjudicator,
  ClusterDecision,
} from "./librarian";

function f(
  id: number,
  statement: string,
  category = "general",
): LibrarianFact {
  return { id, statement, category, sourceLabel: `src${id}`, tokenCount: 10 };
}

describe("trigram similarity", () => {
  it("is 1 for identical strings and 0 for fully disjoint ones", () => {
    expect(
      trigramSimilarity(trigrams("hello world"), trigrams("hello world")),
    ).toBe(1);
    expect(trigramSimilarity(trigrams("abcdef"), trigrams("zyxwvu"))).toBe(0);
  });

  it("scores near-duplicates highly and unrelated text low", () => {
    const near = trigramSimilarity(
      trigrams("Starter plan costs 15 dollars per month"),
      trigrams("Starter plan costs 15 dollars a month"),
    );
    const far = trigramSimilarity(
      trigrams("Starter plan costs 15 dollars per month"),
      trigrams("Refunds are processed within 30 days"),
    );
    expect(near).toBeGreaterThan(0.5);
    expect(far).toBeLessThan(0.2);
  });
});

describe("clusterFacts", () => {
  it("groups near-duplicates and keeps unrelated facts as singletons", () => {
    const facts = [
      f(1, "The starter plan costs 15 dollars per month"),
      f(2, "Starter plan costs 15 dollars a month"),
      f(3, "Refunds are processed within 30 days"),
    ];
    const clusters = clusterFacts(facts);
    const sizes = clusters.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 2]);
    const pair = clusters.find((c) => c.length === 2)!;
    expect(pair.map((x) => x.id).sort()).toEqual([1, 2]);
  });

  it("clusters subtly-different pricing facts via the sensitive threshold", () => {
    const facts = [
      f(1, "The starter plan costs 15 dollars per month", "pricing"),
      f(2, "The starter plan costs 19 dollars per month", "pricing"),
    ];
    expect(clusterFacts(facts)).toHaveLength(1);
  });

  it("clusters same-subject pricing facts with differing numbers despite low textual overlap", () => {
    const facts = [
      f(1, "Pro is 99 monthly", "pricing"),
      f(2, "We bill the Pro tier at 120 annually", "pricing"),
      f(3, "Refunds are processed within 30 days", "general"),
    ];
    const clusters = clusterFacts(facts);
    const sizes = clusters.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 2]);
    const pair = clusters.find((c) => c.length === 2)!;
    expect(pair.map((x) => x.id).sort()).toEqual([1, 2]);
  });

  it("does NOT cluster same-subject pricing facts when the numbers agree", () => {
    const facts = [
      f(1, "Pro is 99 monthly", "pricing"),
      f(2, "The Pro tier includes unlimited seats", "pricing"),
    ];
    // No numeric mismatch (fact 2 has no number) and low textual overlap, so the
    // fallback must not fire — these are distinct facts about the same plan.
    expect(clusterFacts(facts)).toHaveLength(2);
  });

  it("does NOT apply the numeric fallback across non-sensitive categories", () => {
    const facts = [
      f(1, "Dashboard supports 5 widgets", "features"),
      f(2, "We allow up to 9 items on the dashboard", "features"),
    ];
    // Shared subject ("dashboard") + differing numbers, but low textual overlap
    // and 'features' is not high-stakes — the numeric fallback is gated to
    // pricing/compliance, so these correctly stay as two separate facts.
    expect(clusterFacts(facts)).toHaveLength(2);
  });
});

describe("salient + numeric token extraction", () => {
  it("keeps plan/compliance subject tokens and drops generic filler", () => {
    const s = salientTokens("The Pro plan price is billed per month for HIPAA");
    expect(s.has("pro")).toBe(true);
    expect(s.has("hipaa")).toBe(true);
    expect(s.has("plan")).toBe(false);
    expect(s.has("price")).toBe(false);
    expect(s.has("month")).toBe(false);
  });

  it("extracts numeric/currency values, ignoring words", () => {
    const n = numericTokens("Starter is $15.50/mo, Pro is 120 a year");
    expect([...n].sort()).toEqual(["120", "15.50"]);
  });
});

describe("adjudicateForPush", () => {
  it("passes through a single fact without calling the adjudicator", async () => {
    const adj = vi.fn<ClusterAdjudicator>();
    const r = await adjudicateForPush([f(1, "only one fact")], adj);
    expect(adj).not.toHaveBeenCalled();
    expect(r.publish).toHaveLength(1);
    expect(r.mergedCount).toBe(0);
    expect(r.conflictCount).toBe(0);
  });

  it("does not adjudicate dissimilar facts (singletons publish as-is)", async () => {
    const adj = vi.fn<ClusterAdjudicator>();
    const r = await adjudicateForPush(
      [
        f(1, "We are open from 9am to 5pm on weekdays"),
        f(2, "Refunds are processed within 30 days"),
      ],
      adj,
    );
    expect(adj).not.toHaveBeenCalled();
    expect(r.publish).toHaveLength(2);
  });

  it("collapses a duplicate cluster into one merged fact", async () => {
    const adj: ClusterAdjudicator = async () => ({
      decision: "merge",
      mergedStatement: "Starter plan: 15 dollars per month.",
      category: "pricing",
    });
    const r = await adjudicateForPush(
      [
        f(1, "The starter plan costs 15 dollars per month", "pricing"),
        f(2, "Starter plan costs 15 dollars a month", "pricing"),
      ],
      adj,
    );
    expect(r.publish).toHaveLength(1);
    expect(r.publish[0]!.statement).toBe("Starter plan: 15 dollars per month.");
    expect(r.publish[0]!.category).toBe("pricing");
    expect(r.mergedCount).toBe(1);
    expect(r.conflictCount).toBe(0);
  });

  it("flags a contradictory cluster and excludes it from publish", async () => {
    const adj: ClusterAdjudicator = async () => ({
      decision: "conflict",
      reason: "15 vs 19 dollars",
    });
    const r = await adjudicateForPush(
      [
        f(1, "The starter plan costs 15 dollars per month", "pricing"),
        f(2, "The starter plan costs 19 dollars per month", "pricing"),
      ],
      adj,
    );
    expect(r.publish).toHaveLength(0);
    expect(r.conflictCount).toBe(2);
    expect(r.conflicts.map((c) => c.id).sort()).toEqual([1, 2]);
    expect(r.conflicts[0]!.reason).toContain("15 vs 19");
  });

  it("keeps both facts when the adjudicator says distinct", async () => {
    const adj: ClusterAdjudicator = async () => ({ decision: "distinct" });
    const r = await adjudicateForPush(
      [
        f(1, "The starter plan costs 15 dollars per month", "pricing"),
        f(2, "The starter plan costs 15 dollars a month", "pricing"),
      ],
      adj,
    );
    expect(r.publish).toHaveLength(2);
    expect(r.mergedCount).toBe(0);
    expect(r.conflictCount).toBe(0);
  });

  it("fails open (publishes untouched) when the adjudicator throws", async () => {
    const adj: ClusterAdjudicator = async () => {
      throw new Error("grok down");
    };
    const r = await adjudicateForPush(
      [
        f(1, "The starter plan costs 15 dollars per month"),
        f(2, "Starter plan costs 15 dollars a month"),
      ],
      adj,
    );
    expect(r.publish).toHaveLength(2);
    expect(r.conflictCount).toBe(0);
  });

  it("publishes a mix of merged, conflicting, and standalone facts", async () => {
    // Cluster A (dupes) -> merge; cluster B (pricing contradiction) -> conflict;
    // fact C stands alone -> passthrough.
    const adj: ClusterAdjudicator = async (
      cluster,
    ): Promise<ClusterDecision> => {
      if (cluster.some((c) => c.statement.includes("19"))) {
        return { decision: "conflict", reason: "price mismatch" };
      }
      return {
        decision: "merge",
        mergedStatement: "Support replies within 24 hours.",
        category: "features",
      };
    };
    const r = await adjudicateForPush(
      [
        f(1, "Support replies within 24 hours", "features"),
        f(2, "Our support team replies within 24 hours", "features"),
        f(3, "The pro plan costs 15 dollars per month", "pricing"),
        f(4, "The pro plan costs 19 dollars per month", "pricing"),
        f(5, "We are open Monday through Friday", "general"),
      ],
      adj,
    );
    expect(r.mergedCount).toBe(1);
    expect(r.conflictCount).toBe(2);
    // 1 merged + 1 standalone = 2 published; the conflicting pair is excluded.
    expect(r.publish).toHaveLength(2);
    const statements = r.publish.map((p) => p.statement);
    expect(statements).toContain("Support replies within 24 hours.");
    expect(statements).toContain("We are open Monday through Friday");
  });
});
