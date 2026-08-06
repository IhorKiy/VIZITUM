import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { ImportsService } from "../src/modules/imports/imports.service";

// Nothing above the imports service bounds an import's row count: the DTO takes
// `csvText` as a plain string, deliberately, on the grounds that the 100 kB
// JSON body limit already bounds it — and for a dense template that is several
// thousand rows. Audit F8 recorded what the admin got at that size: a 500 at
// confirm time with nothing anywhere saying the file was too big, identical on
// every retry.
//
// The apply path no longer has a per-row cliff, so the cap is not what makes a
// large file work. It is what makes the ceiling *stated*: a named limit the
// preview reports before anything is written, and which keeps every batched
// INSERT inside Postgres's 65 535 bind parameters per statement.

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "admin-a",
  roleCodes: ["company_admin"],
  permissions: [],
};

const MAX_IMPORT_ROWS = 1000;

describe("import row limit", () => {
  it("previews a file at the limit without a row-limit issue", async () => {
    const preview = await validateProducts(MAX_IMPORT_ROWS);

    assert.equal(preview.rowCount, MAX_IMPORT_ROWS);
    assert.equal(
      preview.issues.filter(
        (issue) => issue.code === "IMPORT_ROW_LIMIT_EXCEEDED",
      ).length,
      0,
    );
    assert.equal(preview.canConfirm, true);
  });

  it("blocks a file past the limit and says how far past it is", async () => {
    const preview = await validateProducts(MAX_IMPORT_ROWS + 3);
    const rowLimitIssues = preview.issues.filter(
      (issue) => issue.code === "IMPORT_ROW_LIMIT_EXCEEDED",
    );

    assert.equal(preview.canConfirm, false);

    // One issue per row that would have to move to a second file, so the
    // preview's own counters stay true: the rows that fit are the valid ones.
    assert.equal(rowLimitIssues.length, 3);
    assert.equal(preview.errorRowCount, 3);
    assert.equal(preview.validRowCount, MAX_IMPORT_ROWS);

    // Anchored on the first row past the cap, counting the header the way
    // every other import issue does.
    assert.equal(rowLimitIssues[0]?.rowNumber, MAX_IMPORT_ROWS + 2);
    assert.equal(rowLimitIssues[0]?.severity, "error");

    // The message has to carry both numbers and the way out, because the
    // frontend redirects a failed validation to a generic error code and this
    // text is what the admin actually reads in the issues table.
    assert.match(rowLimitIssues[0]?.message ?? "", /1003 rows/);
    assert.match(rowLimitIssues[0]?.message ?? "", /at most 1000/);
    assert.match(rowLimitIssues[0]?.message ?? "", /Split it/);
  });

  it("refuses to confirm an over-limit job stored before the cap existed", async () => {
    const service = new ImportsService({
      importJob: {
        findFirst: async () => ({
          id: "import-job-products",
          type: "products",
          status: "validated",
          errorRowCount: 0,
          summary: {
            templateType: "products",
            columns: ["name", "external_code", "sku", "category"],
            rows: buildProductRows(MAX_IMPORT_ROWS + 1),
            canConfirm: true,
          },
        }),
      },
      // Reaching a transaction at all would be the failure: the guard runs
      // before the apply opens one.
      $transaction: async () => {
        throw new Error("The apply transaction must not open.");
      },
    } as never);

    await assert.rejects(
      () => service.confirmImportJob(context as never, "import-job-products"),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "IMPORT_ROW_LIMIT_EXCEEDED",
        );

        return true;
      },
    );
  });
});

function validateProducts(rowCount: number) {
  const service = new ImportsService({
    product: { findMany: async () => [] },
  } as never);

  return service.validateImportPreview(context as never, {
    templateType: "products",
    columns: ["name", "external_code", "sku", "category"],
    rows: buildProductRows(rowCount),
  });
}

function buildProductRows(rowCount: number) {
  return Array.from({ length: rowCount }, (_, index) => ({
    name: `Product ${index}`,
    external_code: `SKU-${index}`,
    sku: `SKU-${index}`,
    category: "Drinks",
  }));
}
