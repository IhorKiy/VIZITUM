import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isDayFullyDone } from "../apps/web/lib/visit-history-days";

const TRUSTED_UNFILTERED = {
  dayTotalsTrusted: true,
  statusFilterActive: false,
};

describe("isDayFullyDone", () => {
  it("hides a day whose every workable visit is completed", () => {
    assert.equal(
      isDayFullyDone({ completedPercent: 100, ...TRUSTED_UNFILTERED }),
      true,
    );
  });

  it("keeps a day with anything still open", () => {
    for (const completedPercent of [0, 50, 99]) {
      assert.equal(
        isDayFullyDone({ completedPercent, ...TRUSTED_UNFILTERED }),
        false,
        `${completedPercent}% should stay visible`,
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

  it("hides nothing while a status pill is narrowing the list", () => {
    // Under the "completed" pill every day is 100% by construction; hiding
    // them would empty the very list the rep just asked for.
    assert.equal(
      isDayFullyDone({
        completedPercent: 100,
        dayTotalsTrusted: true,
        statusFilterActive: true,
      }),
      false,
    );
  });

  it("hides nothing when the day totals came from the current page only", () => {
    // The page-local fallback describes this page's slice of a day, not the
    // day. A day split across a page boundary whose slice happens to be all
    // completed must not vanish while the day itself is unfinished.
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
