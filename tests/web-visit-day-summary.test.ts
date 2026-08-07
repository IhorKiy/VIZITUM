import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Visit } from "../apps/web/lib/api-client";
import { summarizeVisitDay } from "../apps/web/lib/visit-day-summary";

// What one day of the field visit history says about itself, in its header.
//
// The header is read whether or not the day is open, so its numbers are the
// only thing a folded day says — which is why they must describe the *day*
// rather than the slice of it that happens to be on this page. That distinction
// is the whole reason the screen makes a second request for the day aggregate,
// and it is invisible until a day straddles the 50-item page boundary.
describe("summarizeVisitDay", () => {
  const visit = (status: Visit["status"]): Visit =>
    ({ status }) as unknown as Visit;

  it("reads the aggregate, which covers days the page has only part of", () => {
    // Three visits that day, one of them further down the next page.
    const summary = summarizeVisitDay({
      summaryEntry: { day: "2026-08-04", total: 3, completed: 2, cancelled: 0 },
      visits: [visit("completed"), visit("in_progress")],
    });

    assert.deepEqual(summary, {
      cancelled: 0,
      completed: 2,
      inProgress: 1,
      total: 3,
    });
  });

  it("falls back to the visits on this page when the aggregate is missing", () => {
    // The day-summary request failed. A header with no numbers at all would be
    // worse than one describing what is on screen, so the page's own visits
    // stand in — this is the only case where the header counts a page.
    const summary = summarizeVisitDay({
      summaryEntry: undefined,
      visits: [visit("completed"), visit("cancelled"), visit("in_progress")],
    });

    assert.deepEqual(summary, {
      cancelled: 1,
      completed: 1,
      inProgress: 1,
      total: 3,
    });
  });

  it("derives what is still open rather than reading a fourth number", () => {
    const summary = summarizeVisitDay({
      summaryEntry: { day: "2026-08-04", total: 5, completed: 1, cancelled: 2 },
      visits: [],
    });

    assert.equal(summary.inProgress, 2);
  });

  it("never reports negative open work", () => {
    // The list and the aggregate are two reads a moment apart: a visit
    // completed between them makes the aggregate's completed+cancelled exceed
    // the total it was counted against. "-1 open" in a day header is a bug
    // report; zero is merely stale for one render.
    const summary = summarizeVisitDay({
      summaryEntry: { day: "2026-08-04", total: 2, completed: 2, cancelled: 1 },
      visits: [],
    });

    assert.equal(summary.inProgress, 0);
  });
});
