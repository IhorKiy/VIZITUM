import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDateOnly } from "../src/modules/routes/route-parsing";

// `parseDateOnly` guards every date a route plan is filed under: the
// `planDate` of `POST /routes` and of `POST /routes/templates/:id/assign`.
// Its comment always claimed it rejected a calendar-invalid day, but it only
// checked `Number.isNaN` — and an out-of-range *day* does not produce NaN,
// it rolls over. So `{"planDate": "2026-02-31"}` was answered 201 for a plan
// silently filed on March 3rd, which is the shape of wrong write the
// class-validator track (2.4 in docs/security-remediation-plan.md) exists to
// find; a DTO in front of these controllers is what turned it up.
//
// The two sibling implementations already did this correctly
// (`normalizeOptionalDateOnly` in location-insights-parsing.ts, pinned by
// tests/location-potential.test.ts; `parseDateOnly` in visits/shelf-check.ts,
// pinned by tests/field-report-visit-date.test.ts). This is the third.

describe("parseDateOnly", () => {
  it("accepts a real calendar day, pinned to UTC midnight", () => {
    const date = parseDateOnly("2026-08-21");

    assert.ok(date);
    assert.equal(date.toISOString(), "2026-08-21T00:00:00.000Z");
  });

  it("accepts February 29th in a leap year and refuses it otherwise", () => {
    assert.ok(parseDateOnly("2028-02-29"));
    assert.equal(parseDateOnly("2026-02-29"), null);
  });

  it("refuses a day past the end of its month instead of rolling it over", () => {
    // Each of these used to return a Date in the *following* month.
    for (const value of ["2026-02-31", "2026-04-31", "2026-06-31"]) {
      assert.equal(
        parseDateOnly(value),
        null,
        `${value} should be refused, not rolled over`,
      );
    }
  });

  it("still refuses an out-of-range month, which the Date constructor catches on its own", () => {
    assert.equal(parseDateOnly("2026-13-01"), null);
    assert.equal(parseDateOnly("2026-00-10"), null);
  });

  it("refuses anything that is not a YYYY-MM-DD string", () => {
    for (const value of [
      "",
      "not-a-date",
      "21/08/2026",
      "2026-8-21",
      42,
      null,
    ]) {
      assert.equal(parseDateOnly(value), null);
    }
  });
});
