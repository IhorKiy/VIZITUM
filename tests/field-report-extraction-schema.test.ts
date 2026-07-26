import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  emptyFieldReportExtractedData,
  FIELD_REPORT_EXTRACTION_SCHEMA,
  normalizeFieldReportExtraction,
} from "../src/modules/ai/field-report-extraction.schema";

describe("field report extraction schema", () => {
  it("keeps the extraction schema closed", () => {
    assert.equal(FIELD_REPORT_EXTRACTION_SCHEMA.additionalProperties, false);
    assert.deepEqual(
      [...(FIELD_REPORT_EXTRACTION_SCHEMA.required ?? [])].sort(),
      [
        "missingProducts",
        "problemType",
        "problemNote",
        "nextActionDueDate",
        "notes",
        "nextAction",
        "noOrderReason",
        "orderPlaced",
        "visitDate",
      ].sort(),
    );
    assert.equal(
      FIELD_REPORT_EXTRACTION_SCHEMA.properties?.missingProducts?.items?.type,
      "string",
    );
  });

  it("returns an empty draft for non-object input", () => {
    assert.deepEqual(
      normalizeFieldReportExtraction(null),
      emptyFieldReportExtractedData(),
    );
    assert.deepEqual(
      normalizeFieldReportExtraction("not an object"),
      emptyFieldReportExtractedData(),
    );
    assert.deepEqual(
      normalizeFieldReportExtraction(["array"]),
      emptyFieldReportExtractedData(),
    );
  });

  it("normalizes a fully populated draft", () => {
    const draft = normalizeFieldReportExtraction({
      orderPlaced: false,
      noOrderReason: "has_stock",
      visitDate: "2026-07-20",
      notes: "  Discussed shelf placement.  ",
      nextAction: "Bring samples next week",
      nextActionDueDate: "2026-07-27",
      missingProducts: ["Vitamin C", "  ", 42, "Zinc"],
      problemType: "expired",
      problemNote: "  two cases past date  ",
    });

    assert.equal(draft.orderPlaced, false);
    assert.equal(draft.noOrderReason, "has_stock");
    assert.equal(draft.visitDate, "2026-07-20");
    assert.equal(draft.notes, "Discussed shelf placement.");
    assert.equal(draft.nextAction, "Bring samples next week");
    assert.equal(draft.nextActionDueDate, "2026-07-27");
    // Blanks and non-strings are dropped rather than carried into the chips.
    assert.deepEqual(draft.missingProducts, ["Vitamin C", "Zinc"]);
    assert.equal(draft.problemType, "expired");
    assert.equal(draft.problemNote, "two cases past date");
  });

  it("rejects invented enums, malformed dates and non-integer quantities", () => {
    const draft = normalizeFieldReportExtraction({
      orderPlaced: "yes",
      noOrderReason: "no_time",
      visitDate: "20-07-2026",
      notes: "",
      nextAction: null,
      nextActionDueDate: "next Friday",
      missingProducts: "not an array",
      problemType: "flood",
      problemNote: "   ",
    });

    assert.equal(draft.orderPlaced, null);
    assert.equal(draft.noOrderReason, null);
    assert.equal(draft.visitDate, null);
    assert.equal(draft.notes, null);
    assert.deepEqual(draft.missingProducts, []);
    assert.equal(draft.nextActionDueDate, null);
    // An unknown problem type must not smuggle a problem into the report.
    assert.equal(draft.problemType, null);
    assert.equal(draft.problemNote, null);
  });

  it("keeps a no-order reason only on a visit that produced no order", () => {
    // The form has nowhere to put a reason once an order is recorded, so a
    // model answering both fields at once must not produce a draft it can't
    // represent.
    const withOrder = normalizeFieldReportExtraction({
      orderPlaced: true,
      noOrderReason: "refused",
    });
    assert.equal(withOrder.orderPlaced, true);
    assert.equal(withOrder.noOrderReason, null);

    const unknownResult = normalizeFieldReportExtraction({
      orderPlaced: null,
      noOrderReason: "closed",
    });
    assert.equal(unknownResult.orderPlaced, null);
    assert.equal(unknownResult.noOrderReason, null);
  });
});
