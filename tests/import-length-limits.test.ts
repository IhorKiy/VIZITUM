import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TEXT_LIMITS } from "../src/common/input-limits";
import { ImportsService } from "../src/modules/imports/imports.service";

// The manual endpoints cap every free-text field through their `normalize*`
// helpers. The import path writes the same columns and did not, so a caller
// could post a location whose name is bounded only by the 100 kB body limit
// where `POST /locations` stops at 120 characters — the same unbounded-`text`
// exposure the caps were added for, reached through a different door.
describe("import length limits", () => {
  it("reports an over-long cell as a row-and-column issue", async () => {
    const service = new ImportsService(createPrisma() as never);

    const preview = await service.validateImportPreview(
      { tenantId: "tenant-a" } as never,
      {
        templateType: "locations",
        columns: ["name", "address_line", "city"],
        rows: [
          {
            name: "A".repeat(TEXT_LIMITS.name + 1),
            address_line: "Main street 1",
            city: "Kyiv",
          },
        ],
      },
    );

    const issue = preview.issues.find(
      (entry) => entry.code === "VALUE_TOO_LONG",
    );

    assert.ok(issue, "expected a VALUE_TOO_LONG issue");
    assert.equal(issue.fieldName, "name");
    assert.equal(issue.rowNumber, 2);
    assert.equal(issue.severity, "error");
    // An issue rather than a thrown error: the import flow answers with
    // everything wrong in the file at once, and a length problem belongs next
    // to a malformed email rather than failing the whole upload.
    assert.equal(preview.canConfirm, false);
  });

  it("accepts a cell at exactly the limit", async () => {
    const service = new ImportsService(createPrisma() as never);

    const preview = await service.validateImportPreview(
      { tenantId: "tenant-a" } as never,
      {
        templateType: "locations",
        columns: ["name", "address_line", "city"],
        rows: [
          {
            name: "A".repeat(TEXT_LIMITS.name),
            address_line: "Main street 1",
            city: "Kyiv",
          },
        ],
      },
    );

    assert.equal(
      preview.issues.filter((entry) => entry.code === "VALUE_TOO_LONG").length,
      0,
    );
  });

  it("caps the columns of every template, not just the one that was reported", async () => {
    const service = new ImportsService(createPrisma() as never);
    const cases = [
      {
        templateType: "users" as const,
        column: "email",
        limit: TEXT_LIMITS.email,
      },
      {
        templateType: "products" as const,
        column: "name",
        limit: TEXT_LIMITS.name,
      },
      {
        templateType: "contacts" as const,
        column: "name",
        limit: TEXT_LIMITS.name,
      },
    ];

    for (const testCase of cases) {
      const preview = await service.validateImportPreview(
        { tenantId: "tenant-a" } as never,
        {
          templateType: testCase.templateType,
          columns: [testCase.column],
          rows: [{ [testCase.column]: "a".repeat(testCase.limit + 1) }],
        },
      );

      assert.ok(
        preview.issues.some(
          (entry) =>
            entry.code === "VALUE_TOO_LONG" &&
            entry.fieldName === testCase.column,
        ),
        `expected ${testCase.templateType}.${testCase.column} to be capped`,
      );
    }
  });
});

function createPrisma() {
  return {
    user: { findMany: async () => [] },
    location: { findMany: async () => [] },
    locationCategory: { findMany: async () => [] },
    locationChain: { findMany: async () => [] },
    locationContact: { findMany: async () => [] },
    product: { findMany: async () => [] },
    tenantSetting: { findFirst: async () => null, findMany: async () => [] },
    platformTenant: {
      findUniqueOrThrow: async () => ({ phoneCountry: "UA" }),
      findUnique: async () => ({ phoneCountry: "UA" }),
    },
    routePlan: { findMany: async () => [] },
    routeItem: { findMany: async () => [] },
  };
}
