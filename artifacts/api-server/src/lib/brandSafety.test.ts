import { describe, it, expect } from "vitest";
import {
  rebrandText,
  containsCompetitor,
  parseCompetitorNames,
} from "@workspace/brand-safety";

describe("rebrandText", () => {
  it("replaces the competitor name case-insensitively", () => {
    expect(rebrandText("Switch from TextLine today").text).toBe(
      "Switch from Textitie today",
    );
    expect(rebrandText("textline rocks").text).toBe("Textitie rocks");
    expect(rebrandText("TEXTLINE").text).toBe("Textitie");
  });

  it("preserves the possessive and surrounding punctuation", () => {
    expect(rebrandText("TextLine's pricing is high").text).toBe(
      "Textitie's pricing is high",
    );
    expect(rebrandText("see TextLine.com").text).toBe("see Textitie.com");
  });

  it("handles the plural variant", () => {
    expect(rebrandText("multiple TextLines exist").text).toBe(
      "multiple Textitie exist",
    );
  });

  it("does NOT touch unrelated English (no two-word false positives)", () => {
    const s = "Please text the line manager about your textbook.";
    expect(rebrandText(s).text).toBe(s);
    const s2 = "The text line was busy all morning.";
    expect(rebrandText(s2).text).toBe(s2);
  });

  it("counts replacements and detects residue", () => {
    const r = rebrandText("TextLine and TextLine");
    expect(r.replacements).toBe(2);
    expect(containsCompetitor(r.text)).toBe(false);
    expect(containsCompetitor("call TextLine for help")).toBe(true);
    expect(containsCompetitor("nothing to see here")).toBe(false);
  });

  it("is idempotent", () => {
    const once = rebrandText("Leaving TextLine for good").text;
    expect(rebrandText(once).text).toBe(once);
  });

  it("is safe on null/empty", () => {
    expect(rebrandText(null).text).toBe("");
    expect(rebrandText(undefined).text).toBe("");
    expect(rebrandText("").text).toBe("");
    expect(rebrandText("").replacements).toBe(0);
  });
});

describe("parseCompetitorNames", () => {
  it("splits, trims, and drops empties; safe on null/undefined", () => {
    expect(parseCompetitorNames("Foo, Bar ,  Baz")).toEqual([
      "Foo",
      "Bar",
      "Baz",
    ]);
    expect(parseCompetitorNames(" , ,")).toEqual([]);
    expect(parseCompetitorNames(null)).toEqual([]);
    expect(parseCompetitorNames(undefined)).toEqual([]);
  });
});

describe("rebrandText with per-tenant extras", () => {
  it("scrubs an extra competitor name on top of the base list", () => {
    // Base list still applies...
    expect(rebrandText("Switch from TextLine", ["Zipwhip"]).text).toBe(
      "Switch from Textitie",
    );
    // ...and so does the per-tenant extra.
    const r = rebrandText("We loved Zipwhip before", ["Zipwhip"]);
    expect(r.text).toBe("We loved Textitie before");
    expect(r.replacements).toBe(1);
  });

  it("matches extras case-insensitively and preserves possessives", () => {
    expect(rebrandText("zipwhip's API was clunky", ["Zipwhip"]).text).toBe(
      "Textitie's API was clunky",
    );
  });

  it("handles a multi-word extra with flexible whitespace", () => {
    expect(
      rebrandText("migrated off Sales Messenger last year", [
        "Sales Messenger",
      ]).text,
    ).toBe("migrated off Textitie last year");
  });

  it("does not double-count an extra that duplicates the base (case-insensitive)", () => {
    const r = rebrandText("leaving textline", ["TextLine", "TEXTLINE"]);
    expect(r.text).toBe("leaving Textitie");
    expect(r.replacements).toBe(1);
  });

  it("containsCompetitor honors extras", () => {
    expect(containsCompetitor("ask Zipwhip", ["Zipwhip"])).toBe(true);
    expect(containsCompetitor("ask Zipwhip")).toBe(false);
  });

  it("leaves text clean when an extra name is unrelated", () => {
    const s = "Nothing competitive here at all.";
    expect(rebrandText(s, ["Zipwhip"]).text).toBe(s);
    expect(rebrandText(s, ["Zipwhip"]).replacements).toBe(0);
  });
});
