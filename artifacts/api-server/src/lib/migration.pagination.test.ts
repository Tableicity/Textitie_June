import { afterEach, describe, expect, it, vi } from "vitest";
import { detectHasMore, fetchListPage, PAGE_START } from "./textlineClient";

// Pure unit tests for the TextLine extraction pagination contract. The migration
// must walk list endpoints 0-based (page=0..n until an EMPTY page), so the FIRST
// page is never skipped. These prove the wire request and the has-more detector
// honor that base. (Resume/re-run de-dup is enforced separately by the staging
// ON CONFLICT(job_id, record_key) and the idempotent hydrate re-run test in
// migration.customers.test.ts, so it is not re-proved here.)
describe("TextLine pagination is 0-based (page=0..n)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PAGE_START is 0 so extraction begins at the first page", () => {
    expect(PAGE_START).toBe(0);
  });

  it("requests page=0 on the first page (the first page is never skipped)", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        seen.push(String(url));
        return new Response(
          JSON.stringify({ conversations: [{ id: "a" }, { id: "b" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const page = await fetchListPage("conversations", "tok", PAGE_START);

    expect(page.records).toHaveLength(2);
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0]);
    expect(url.searchParams.get("page")).toBe("0");
    expect(url.searchParams.get("per_page")).toBe("100");
  });

  it("detectHasMore: an empty page always terminates the walk", () => {
    expect(detectHasMore({ conversations: [] }, 0, 0)).toBe(false);
    expect(detectHasMore({ total_pages: 99 }, 7, 0)).toBe(false);
  });

  it("detectHasMore: total_pages is a count, last valid index is total - 1", () => {
    // 1 page total -> stop right after page 0 (no empty trailing page over-fetch).
    expect(detectHasMore({ total_pages: 1 }, 0, 5)).toBe(false);
    // 3 pages total -> indices 0,1 have more; index 2 is the last.
    expect(detectHasMore({ total_pages: 3 }, 0, 5)).toBe(true);
    expect(detectHasMore({ total_pages: 3 }, 1, 5)).toBe(true);
    expect(detectHasMore({ total_pages: 3 }, 2, 5)).toBe(false);
  });

  it("detectHasMore: explicit has_more / next_page metadata wins", () => {
    expect(detectHasMore({ has_more: true, items: [1] }, 0, 1)).toBe(true);
    expect(detectHasMore({ has_more: false, items: [1] }, 0, 1)).toBe(false);
    expect(detectHasMore({ next_page: 2, items: [1] }, 0, 1)).toBe(true);
    // A defined falsy next_page (0) means "no next page".
    expect(detectHasMore({ next_page: 0, items: [1] }, 0, 1)).toBe(false);
  });

  it("detectHasMore: a non-empty page with no metadata assumes more (caller caps pages)", () => {
    expect(detectHasMore({ items: [1, 2, 3] }, 0, 3)).toBe(true);
  });
});
