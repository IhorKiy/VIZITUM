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
        "notes",
        "nextAction",
        "outcome",
        "productUpdates",
        "productsPresented",
        "stockStatus",
        "tasks",
        "visitDate",
      ].sort(),
    );
    assert.equal(
      FIELD_REPORT_EXTRACTION_SCHEMA.properties?.productUpdates?.items
        ?.additionalProperties,
      false,
    );
    assert.equal(
      FIELD_REPORT_EXTRACTION_SCHEMA.properties?.tasks?.additionalProperties,
      false,
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
      outcome: "positive",
      visitDate: "2026-07-20",
      productsPresented: ["Vitamin C", "  ", 42, "Zinc"],
      stockStatus: "low_stock",
      notes: "  Discussed shelf placement.  ",
      nextAction: "Bring samples next week",
      productUpdates: [
        {
          productName: "Vitamin C",
          productCode: "VTC-100",
          status: "to_order",
          stock: 3,
          order: 10,
          sale: 2,
          comment: "Running low",
        },
      ],
      tasks: {
        dueDate: "2026-07-27",
        assortment: "Restock vitamin C",
        merchandising: null,
        recommendation: "Recommend zinc for immunity",
        special: null,
        note: "Ask for the pharmacist by name",
      },
    });

    assert.equal(draft.outcome, "positive");
    assert.equal(draft.visitDate, "2026-07-20");
    assert.deepEqual(draft.productsPresented, ["Vitamin C", "Zinc"]);
    assert.equal(draft.stockStatus, "low_stock");
    assert.equal(draft.notes, "Discussed shelf placement.");
    assert.equal(draft.nextAction, "Bring samples next week");
    assert.deepEqual(draft.productUpdates, [
      {
        productName: "Vitamin C",
        productCode: "VTC-100",
        status: "to_order",
        stock: 3,
        order: 10,
        sale: 2,
        comment: "Running low",
      },
    ]);
    assert.deepEqual(draft.tasks, {
      dueDate: "2026-07-27",
      assortment: "Restock vitamin C",
      merchandising: null,
      recommendation: "Recommend zinc for immunity",
      special: null,
      note: "Ask for the pharmacist by name",
    });
  });

  it("rejects invented enums, malformed dates and non-integer quantities", () => {
    const draft = normalizeFieldReportExtraction({
      outcome: "excellent",
      visitDate: "20-07-2026",
      productsPresented: "not an array",
      stockStatus: "plenty",
      notes: "",
      nextAction: null,
      productUpdates: [
        {
          productName: null,
          productCode: null,
          status: "in_stock",
          stock: 5,
          order: 0,
          sale: 0,
          comment: null,
        },
        {
          productName: "Vitamin C",
          productCode: null,
          status: "unknown_status",
          stock: -3,
          order: 1.5,
          sale: "4",
          comment: null,
        },
      ],
      tasks: "not an object",
    });

    assert.equal(draft.outcome, null);
    assert.equal(draft.visitDate, null);
    assert.deepEqual(draft.productsPresented, []);
    assert.equal(draft.stockStatus, null);
    assert.equal(draft.notes, null);
    // The first update has neither a name nor a code, so it is dropped
    // entirely rather than kept as an empty row.
    assert.equal(draft.productUpdates.length, 1);
    assert.deepEqual(draft.productUpdates[0], {
      productName: "Vitamin C",
      productCode: null,
      status: null,
      stock: null,
      order: null,
      sale: null,
      comment: null,
    });
    assert.deepEqual(draft.tasks, emptyFieldReportExtractedData().tasks);
  });
});
