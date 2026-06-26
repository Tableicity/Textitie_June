import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  classroomVersionsTable,
  classroomFactsTable,
} from "@workspace/db";
import { retrieveClassroomFactsWithMatch } from "./knowledge";

// DB-backed: retrieveClassroomFactsWithMatch runs real deterministic FTS SQL
// (no LLM seam), so we assert match TYPE + returned facts against the real test
// DB, per the project's DB-backed test pattern (never vi.mock(@workspace/db)).
//
// Reproduces the production scenario: of 6 grounded SMS questions only the 2
// near-verbatim ones auto-answered; the 4 paraphrases stalled because the
// AND-only retrieval missed on a query word the fact never uses ("difference",
// "many"/"single", "kind"/"include", "long"). The new coverage tier must ground
// those paraphrases while a single-topic-word overlap still falls back.

const RUN = `coverage-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let tenantId = 0;

// Statements mirror the real classroom facts (categories included so we can
// prove the coverage match NARROWS to the relevant facts, not the whole dump).
const F_PLAIN_TEXT = "SMS messages are sent in plain text.";
const F_SUBPOENA =
  "Stored SMS message records can be subpoenaed by law enforcement.";
const F_SEGMENT = "An SMS message segment contains up to 160 characters.";
const F_MMS_MEDIA =
  "An MMS message can include multimedia content like images, audio, and video clips.";
const F_CARRIER_STORAGE =
  "Mobile carriers store text messages for varying periods of time.";
const F_DIFFERENCE =
  "SMS sends plain text while MMS sends multimedia like pictures and video.";

const SEED: Array<{ statement: string; category: string }> = [
  { statement: F_PLAIN_TEXT, category: "general" },
  { statement: F_SUBPOENA, category: "compliance" },
  { statement: F_SEGMENT, category: "general" },
  { statement: F_MMS_MEDIA, category: "features" },
  { statement: F_CARRIER_STORAGE, category: "general" },
  { statement: F_DIFFERENCE, category: "features" },
];

beforeAll(async () => {
  const [t] = await db
    .insert(tenantsTable)
    .values({
      slug: RUN,
      name: `Coverage ${RUN}`,
      region: "us",
      tierCode: "starter",
      phoneNumber: `+1976${String(Date.now()).slice(-7)}`,
    })
    .returning({ id: tenantsTable.id });
  tenantId = t.id;

  const [v] = await db
    .insert(classroomVersionsTable)
    .values({
      tenantId,
      version: 1,
      status: "published",
      summary: "coverage test version",
      factCount: SEED.length,
      tokenCount: 0,
    })
    .returning();

  await db.insert(classroomFactsTable).values(
    SEED.map((f) => ({
      tenantId,
      versionId: v.id,
      sourceLabel: "Library",
      statement: f.statement,
      category: f.category,
      tokenCount: 3,
    })),
  );
});

afterAll(async () => {
  if (tenantId) {
    await db
      .delete(classroomFactsTable)
      .where(eq(classroomFactsTable.tenantId, tenantId));
    await db
      .delete(classroomVersionsTable)
      .where(eq(classroomVersionsTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  }
});

// Match TYPE is independent of the query category boost, so we retrieve without
// a category to isolate the AND/coverage/fallback decision.
const retrieve = (q: string) => retrieveClassroomFactsWithMatch(tenantId, q);

describe("retrieveClassroomFactsWithMatch — coverage tier", () => {
  it('keeps near-verbatim questions on the strict "fts" tier', async () => {
    const a = await retrieve("Are SMS messages sent in plain text?");
    expect(a.matchType).toBe("fts");
    expect(a.facts.map((f) => f.statement)).toContain(F_PLAIN_TEXT);

    const b = await retrieve("Can stored SMS records be subpoenaed?");
    expect(b.matchType).toBe("fts");
    expect(b.facts.map((f) => f.statement)).toContain(F_SUBPOENA);
  });

  it('grounds a paraphrase missing one content word ("difference") as "coverage"', async () => {
    const r = await retrieve("What is the difference between SMS and MMS?");
    expect(r.matchType).toBe("coverage");
    expect(r.facts.map((f) => f.statement)).toContain(F_DIFFERENCE);
  });

  it('grounds "how many ... single" paraphrase (exactly 2/3 coverage) as "coverage"', async () => {
    const r = await retrieve(
      "How many characters are in a single SMS message segment?",
    );
    expect(r.matchType).toBe("coverage");
    expect(r.facts.map((f) => f.statement)).toContain(F_SEGMENT);
  });

  it('grounds "what kind ... include" paraphrase as "coverage"', async () => {
    const r = await retrieve(
      "What kind of multimedia content can an MMS message include?",
    );
    expect(r.matchType).toBe("coverage");
    expect(r.facts.map((f) => f.statement)).toContain(F_MMS_MEDIA);
  });

  it('grounds "how long" paraphrase as "coverage" and NARROWS to the matched (safe) facts', async () => {
    const r = await retrieve("How long do mobile carriers store text messages?");
    expect(r.matchType).toBe("coverage");
    const statements = r.facts.map((f) => f.statement);
    expect(statements).toContain(F_CARRIER_STORAGE);
    // The whole-version dump (which would leak the compliance fact and every
    // category) must NOT happen: a coverage match returns only matched facts.
    expect(statements).not.toContain(F_SUBPOENA);
    expect(r.facts.length).toBeLessThan(SEED.length);
  });

  it("does NOT ground an incidental single-topic-word overlap (matched < 2) — falls back", async () => {
    // Shares only "message" with the facts → 1 matched lexeme → below the
    // matched>=2 floor, so it must not present as a real grounding signal.
    const r = await retrieve("Will my message be delivered instantly?");
    expect(r.matchType).toBe("fallback");
  });

  it("keeps category boost a TIE-BREAKER, not a gate: a misclassified category cannot bury a qualifying off-category fact", async () => {
    // Regression guard: the coverage candidate scan caps at 24 rows BEFORE the
    // JS qualification filter. If the (possibly wrong) query category boosted
    // low-overlap same-category rows above a genuinely-qualifying off-category
    // fact, that fact would be pushed out of the window and the turn would wrongly
    // fall back. Ordering by overlap first must prevent that.
    const [t] = await db
      .insert(tenantsTable)
      .values({
        slug: `${RUN}-boost`,
        name: `Boost ${RUN}`,
        region: "us",
        tierCode: "starter",
        phoneNumber: `+1978${String(Date.now()).slice(-7)}`,
      })
      .returning({ id: tenantsTable.id });
    try {
      const [v] = await db
        .insert(classroomVersionsTable)
        .values({
          tenantId: t.id,
          version: 1,
          status: "published",
          summary: "boost guard version",
          factCount: 0,
          tokenCount: 0,
        })
        .returning();

      // 30 "pricing" filler facts that each share exactly ONE query lexeme
      // ("message") → matched=1 (never qualifies) but pass the OR prefilter.
      const fillers = Array.from({ length: 30 }, (_, i) => ({
        tenantId: t.id,
        versionId: v.id,
        sourceLabel: "Library",
        statement: `Pricing message option ${i}.`,
        category: "pricing",
        tokenCount: 3,
      }));
      // One qualifying off-category ("general") fact at high overlap.
      const qualifying = {
        tenantId: t.id,
        versionId: v.id,
        sourceLabel: "Library",
        statement: F_CARRIER_STORAGE,
        category: "general",
        tokenCount: 3,
      };
      await db.insert(classroomFactsTable).values([...fillers, qualifying]);

      // Retrieve with the WRONG category (pricing) — the boost would, if it led
      // the sort, fill the 24-row window with filler and bury F_CARRIER_STORAGE.
      const r = await retrieveClassroomFactsWithMatch(
        t.id,
        "How long do mobile carriers store text messages?",
        { category: "pricing" },
      );
      expect(r.matchType).toBe("coverage");
      expect(r.facts.map((f) => f.statement)).toContain(F_CARRIER_STORAGE);
    } finally {
      await db.delete(classroomFactsTable).where(eq(classroomFactsTable.tenantId, t.id));
      await db
        .delete(classroomVersionsTable)
        .where(eq(classroomVersionsTable.tenantId, t.id));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, t.id));
    }
  });

  it("returns matchType none when the tenant has no published version", async () => {
    const [t] = await db
      .insert(tenantsTable)
      .values({
        slug: `${RUN}-empty`,
        name: `Empty ${RUN}`,
        region: "us",
        tierCode: "starter",
        phoneNumber: `+1977${String(Date.now()).slice(-7)}`,
      })
      .returning({ id: tenantsTable.id });
    try {
      const r = await retrieveClassroomFactsWithMatch(
        t.id,
        "Are SMS messages sent in plain text?",
      );
      expect(r.matchType).toBe("none");
      expect(r.facts).toHaveLength(0);
    } finally {
      await db.delete(tenantsTable).where(eq(tenantsTable.id, t.id));
    }
  });
});
