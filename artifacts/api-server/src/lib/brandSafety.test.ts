import { describe, it, expect } from "vitest";
import { rebrandText, containsCompetitor } from "@workspace/brand-safety";

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
