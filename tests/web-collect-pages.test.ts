import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectAllPages,
  MAX_COLLECTED_PAGES,
  type PageResult,
} from "../apps/web/lib/collect-pages";

// The field planning screen reads a whole date range — a week, or a month —
// out of `GET /routes`. The range filter decides which plans come back but
// not how many: the API caps pageSize at 100 (MAX_PAGE_SIZE,
// src/common/pagination.ts) whatever is asked for, and a 31-day month at four
// routes a day is 124 plans. The list arrives `planDate desc`, so the single
// page that fits holds the *late* dates and the opening week of the month
// would render as unplanned — a silently truncated window, which is the class
// of bug the range filter was added to close in the first place.

type Fetcher = {
  fetchPage: (page: number) => Promise<PageResult<string>>;
  requested: number[];
};

/** Serves `items` in pages of `pageSize`, recording which pages were asked for. */
function buildFetcher(items: string[], pageSize: number): Fetcher {
  const requested: number[] = [];
  const totalPages = Math.ceil(items.length / pageSize);

  return {
    requested,
    fetchPage: async (page: number) => {
      requested.push(page);

      return {
        ok: true,
        data: {
          items: items.slice((page - 1) * pageSize, page * pageSize),
          totalPages,
        },
      };
    },
  };
}

describe("collectAllPages", () => {
  it("returns the first page alone when that is the whole answer", async () => {
    const { fetchPage, requested } = buildFetcher(["a", "b"], 10);

    assert.deepEqual(await collectAllPages(fetchPage), ["a", "b"]);
    assert.deepEqual(
      requested,
      [1],
      "no second request when there is one page",
    );
  });

  it("reads every page of the range, in page order", async () => {
    const items = Array.from({ length: 124 }, (_, index) => `plan-${index}`);
    const { fetchPage, requested } = buildFetcher(items, 100);

    const collected = await collectAllPages(fetchPage);

    assert.equal(collected?.length, 124);
    assert.deepEqual(collected, items);
    assert.deepEqual(
      requested.sort((a, b) => a - b),
      [1, 2],
    );
  });

  it("keeps page order even when later pages resolve out of order", async () => {
    // Pages after the first are fetched together, so the network may answer
    // page 3 before page 2; the caller must still see the API's own order.
    const fetchPage = async (page: number): Promise<PageResult<string>> => {
      await new Promise((resolve) => setTimeout(resolve, (5 - page) * 10));

      return {
        ok: true,
        data: { items: [`page-${page}`], totalPages: 4 },
      };
    };

    assert.deepEqual(await collectAllPages(fetchPage), [
      "page-1",
      "page-2",
      "page-3",
      "page-4",
    ]);
  });

  it("answers null when the first page fails", async () => {
    assert.equal(await collectAllPages(async () => ({ ok: false })), null);
  });

  it("answers null — not a partial list — when a later page fails", async () => {
    // Handing back only the pages that arrived would put a calendar on screen
    // that looks complete and is not, which is the failure this exists to
    // prevent.
    const fetchPage = async (page: number): Promise<PageResult<string>> =>
      page === 2
        ? { ok: false }
        : { ok: true, data: { items: [`page-${page}`], totalPages: 3 } };

    assert.equal(await collectAllPages(fetchPage), null);
  });

  it("stops at the page cap rather than trusting an unbounded totalPages", async () => {
    const requested: number[] = [];
    const fetchPage = async (page: number): Promise<PageResult<string>> => {
      requested.push(page);

      return {
        ok: true,
        data: { items: [`page-${page}`], totalPages: 10_000 },
      };
    };

    const collected = await collectAllPages(fetchPage);

    assert.equal(collected?.length, MAX_COLLECTED_PAGES);
    assert.equal(requested.length, MAX_COLLECTED_PAGES);
  });

  it("honours a caller-supplied cap", async () => {
    const items = Array.from({ length: 50 }, (_, index) => `plan-${index}`);
    const { fetchPage } = buildFetcher(items, 10);

    assert.deepEqual(await collectAllPages(fetchPage, 2), items.slice(0, 20));
  });

  it("treats a missing or nonsense totalPages as a single page", async () => {
    for (const totalPages of [Number.NaN, Infinity, undefined as never]) {
      const requested: number[] = [];
      const collected = await collectAllPages<string>(async (page) => {
        requested.push(page);
        return { ok: true, data: { items: ["only"], totalPages } };
      });

      // Infinity is finite-checked away; NaN and a missing field would
      // otherwise make the loop bound NaN.
      assert.deepEqual(collected, ["only"]);
      assert.deepEqual(requested, [1], `totalPages=${String(totalPages)}`);
    }
  });

  it("returns an empty list for an empty range", async () => {
    const collected = await collectAllPages<string>(async () => ({
      ok: true,
      data: { items: [], totalPages: 0 },
    }));

    assert.deepEqual(collected, []);
  });
});
