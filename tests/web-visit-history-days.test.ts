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
      isDayFullyDone({ completedPercent: 100, ...TRUSTED_UNFILTERED }),
      true,
    );
  });

  it("keeps a day with anything still open in the running list", () => {
    for (const completedPercent of [0, 50, 99]) {
      assert.equal(
        isDayFullyDone({ completedPercent, ...TRUSTED_UNFILTERED }),
        false,
        `${completedPercent}% should stay in the running list`,
      );
    }
  });

  it("keeps a day that has no completed share at all", () => {
    // Every visit cancelled: nothing was left undone, but nothing was worked
    // either, so the day is not "done" — it carries its own cancelled pills.
    assert.equal(
      isDayFullyDone({ completedPercent: null, ...TRUSTED_UNFILTERED }),
      false,
    );
  });

  it("folds nothing away while a status pill is narrowing the list", () => {
    // Under the "completed" pill every day is 100% by construction; folding
    // them away would put the very list the rep asked for behind a lid.
    assert.equal(
      isDayFullyDone({
        completedPercent: 100,
        dayTotalsTrusted: true,
        statusFilterActive: true,
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
        completedPercent: 100,
        dayTotalsTrusted: false,
        statusFilterActive: false,
      }),
      false,
    );
  });
});
