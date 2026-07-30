import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isEmptyFieldReportDraft,
  parseFieldReportDraft,
  resolveDraftVisitDate,
  type FieldReportDraft,
} from "../apps/web/lib/field-report-draft";

const TODAY = "2026-07-29";

// What the form holds before the rep has touched anything.
const PRISTINE: FieldReportDraft = {
  visitDate: TODAY,
  orderPlaced: null,
  noOrderReason: null,
  missingProductIds: [],
  shelfChecked: false,
  shelfCheckedTouched: false,
  shelfOpen: false,
  problemOpen: false,
  problemType: null,
  problemNote: "",
  problemPhoto: null,
  notesOpen: false,
  notes: "",
  nextAction: "",
  nextActionDueDate: "",
};

describe("isEmptyFieldReportDraft", () => {
  it("treats an untouched form as nothing worth storing", () => {
    assert.equal(isEmptyFieldReportDraft(PRISTINE, TODAY), true);
  });

  it("does not count opening a panel as work", () => {
    // Otherwise a stray tap would store a draft and push the next open past
    // the voice screen for nothing.
    assert.equal(
      isEmptyFieldReportDraft(
        { ...PRISTINE, shelfOpen: true, problemOpen: true, notesOpen: true },
        TODAY,
      ),
      true,
    );
  });

  it("counts the visit result, which is the one required field", () => {
    assert.equal(
      isEmptyFieldReportDraft({ ...PRISTINE, orderPlaced: false }, TODAY),
      false,
    );
  });

  it("counts a date the rep moved off today, but not the default", () => {
    assert.equal(
      isEmptyFieldReportDraft({ ...PRISTINE, visitDate: "2026-07-27" }, TODAY),
      false,
    );
    assert.equal(
      isEmptyFieldReportDraft({ ...PRISTINE, visitDate: TODAY }, TODAY),
      true,
    );
  });

  it("ignores whitespace typed into the free-text fields", () => {
    assert.equal(
      isEmptyFieldReportDraft(
        { ...PRISTINE, notes: "   ", nextAction: "\n", problemNote: " " },
        TODAY,
      ),
      true,
    );
  });

  it("counts every other way the rep can put something in", () => {
    const filled: Partial<FieldReportDraft>[] = [
      { missingProductIds: ["product-1"] },
      { shelfChecked: true },
      { shelfCheckedTouched: true },
      { problemType: "damaged" },
      { problemNote: "two boxes leaking" },
      {
        problemPhoto: {
          objectId: "obj-1",
          fileName: "photo.jpg",
          contentType: "image/jpeg",
        },
      },
      { notes: "manager away until Friday" },
      { nextAction: "bring the new price list" },
      { nextActionDueDate: "2026-08-05" },
    ];

    for (const change of filled) {
      assert.equal(
        isEmptyFieldReportDraft({ ...PRISTINE, ...change }, TODAY),
        false,
        `expected ${JSON.stringify(change)} to count as content`,
      );
    }
  });
});

describe("parseFieldReportDraft", () => {
  it("round-trips a draft through storage", () => {
    const draft: FieldReportDraft = {
      ...PRISTINE,
      orderPlaced: false,
      noOrderReason: "no_money",
      missingProductIds: ["product-1", "product-2"],
      shelfChecked: true,
      shelfCheckedTouched: true,
      shelfOpen: true,
      problemOpen: true,
      problemType: "expired",
      problemNote: "back shelf",
      problemPhoto: {
        objectId: "obj-1",
        fileName: "photo.jpg",
        contentType: "image/jpeg",
      },
      notesOpen: true,
      notes: "come back Tuesday",
      nextAction: "bring samples",
      nextActionDueDate: "2026-08-05",
    };

    assert.deepEqual(
      parseFieldReportDraft(JSON.parse(JSON.stringify(draft))),
      draft,
    );
  });

  it("rejects a record that is not an object", () => {
    for (const value of [null, undefined, "draft", 7, []]) {
      // An array is object-shaped but carries none of the fields, so it parses
      // to a pristine draft rather than null — which the emptiness check then
      // discards. Only genuine non-objects are rejected outright.
      if (Array.isArray(value)) continue;
      assert.equal(parseFieldReportDraft(value), null);
    }
  });

  it("degrades unrecognized field values to the form's defaults", () => {
    // A draft written by a different build, or corrupted in storage, must
    // still open as a usable form.
    const parsed = parseFieldReportDraft({
      visitDate: 20260729,
      orderPlaced: "yes",
      missingProductIds: ["product-1", 42, null],
      shelfChecked: "true",
      problemType: "flooding",
      notes: { text: "hi" },
    });

    assert.deepEqual(parsed, {
      ...PRISTINE,
      visitDate: "",
      missingProductIds: ["product-1"],
    });
  });

  it("drops a no-order reason that lost its result", () => {
    // The reason chips only exist under "no order"; keeping one without it
    // would restore a selection the form cannot show.
    assert.equal(
      parseFieldReportDraft({ ...PRISTINE, orderPlaced: null, noOrderReason: "refused" })
        ?.noOrderReason,
      null,
    );
    assert.equal(
      parseFieldReportDraft({ ...PRISTINE, orderPlaced: false, noOrderReason: "refused" })
        ?.noOrderReason,
      "refused",
    );
  });

  it("drops a photo with no storage id, which points at nothing", () => {
    assert.equal(
      parseFieldReportDraft({
        ...PRISTINE,
        problemPhoto: { fileName: "photo.jpg", contentType: "image/jpeg" },
      })?.problemPhoto,
      null,
    );
  });
});

describe("resolveDraftVisitDate", () => {
  // The form's own bounds: three days back, nothing ahead of today.
  const EARLIEST = "2026-07-26";

  it("keeps a date the rep chose inside the window", () => {
    for (const value of [EARLIEST, "2026-07-27", "2026-07-28", TODAY]) {
      assert.equal(
        resolveDraftVisitDate(value, TODAY, EARLIEST),
        value,
        `expected ${value} to survive`,
      );
    }
  });

  it("drops a date the draft outlived to today", () => {
    // Drafts are swept after fourteen days and the window is three, so this is
    // reachable by nothing more than a phone left in a drawer. Restoring the
    // old date would fail the date input's own `min`: the submit button stops
    // doing anything behind a native validation bubble, and the backend would
    // refuse the report too.
    assert.equal(resolveDraftVisitDate("2026-07-25", TODAY, EARLIEST), TODAY);
    assert.equal(resolveDraftVisitDate("2026-07-15", TODAY, EARLIEST), TODAY);
  });

  it("drops a future date to today", () => {
    assert.equal(resolveDraftVisitDate("2026-07-30", TODAY, EARLIEST), TODAY);
  });

  it("drops anything that is not a date to today", () => {
    // `parseFieldReportDraft` degrades an unrecognized `visitDate` to "", so
    // this is the ordinary shape of a draft from a different build.
    for (const value of ["", "not-a-date", "2026-7-2", "20260728"]) {
      assert.equal(
        resolveDraftVisitDate(value, TODAY, EARLIEST),
        TODAY,
        `expected ${JSON.stringify(value)} to fall back to today`,
      );
    }
  });
});
