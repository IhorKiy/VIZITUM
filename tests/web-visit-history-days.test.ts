import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isDayFullyDone } from "../apps/web/lib/visit-history-days";

const TRUSTED_UNFILTERED = {
  dayTotalsTrusted: true,
  statusFilterActive: false,
};

describe("isDayFullyDone", () => {
  it("files a day whose every workable visit is completed into the tail", () => {
    assert.equal(
      isDayFullyDone({ completed: 4, workable: 4, ...TRUSTED_UNFILTERED }),
      true,
    );
  });

  it("keeps a day with anything still open in the running list", () => {
    for (const [completed, workable] of [
      [0, 3],
      [1, 2],
      [3, 4],
    ]) {
      assert.equal(
        isDayFullyDone({ completed, workable, ...TRUSTED_UNFILTERED }),
        false,
        `${completed}/${workable} should stay in the running list`,
      );
    }
  });

  it("does not let the rounded share decide that a day is finished", () => {
    // The header renders Math.round((199 / 200) * 100) === 100%, but a visit is
    // still open. The share may flatter the day; it must not fold it away.
    assert.equal(
      isDayFullyDone({ completed: 199, workable: 200, ...TRUSTED_UNFILTERED }),
      false,
    );
  });

  it("keeps a day that had nothing to finish", () => {
    // Every visit cancelled: nothing was left undone, but nothing was worked
    // either, so the day is not "done" — it carries its own cancelled pills.
    assert.equal(
      isDayFullyDone({ completed: 0, workable: 0, ...TRUSTED_UNFILTERED }),
      false,
    );
  });

  it("folds nothing away while a status pill is narrowing the list", () => {
    // Under the "completed" pill every day is fully done by construction;
    // folding them would put the very list the rep asked for behind a lid.
    assert.equal(
      isDayFullyDone({
        completed: 4,
        dayTotalsTrusted: true,
        statusFilterActive: true,
        workable: 4,
      }),
      false,
    );
  });

  it("folds nothing away when the day totals came from the current page only", () => {
    // The page-local fallback describes this page's slice of a day, not the
    // day. A day split across a page boundary whose slice happens to be all
    // completed must not be filed as finished while the day is unfinished.
    assert.equal(
      isDayFullyDone({
        completed: 4,
        dayTotalsTrusted: false,
        statusFilterActive: false,
        workable: 4,
      }),
      false,
    );
  });
});
