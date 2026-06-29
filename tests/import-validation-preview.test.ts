import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ImportsService } from "../src/modules/imports/imports.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "user-a",
  roleCodes: ["company_admin"],
  permissions: [],
};

describe("import validation preview", () => {
  it("validates users against tenant state and file duplicates", async () => {
    const service = new ImportsService({
      user: {
        findMany: async () => [{ email: "existing@example.com" }],
      },
    } as never);

    const preview = await service.validateImportPreview(context as never, {
      templateType: "users",
      columns: ["email", "name", "roles"],
      rows: [
        {
          email: "new@example.com",
          name: "New User",
          roles: "company_admin",
        },
        {
          email: "new@example.com",
          name: "Duplicate User",
          roles: "unknown_role",
        },
        {
          email: "existing@example.com",
          name: "Existing User",
          roles: "field_representative",
        },
      ],
    });

    assert.equal(preview.rowCount, 3);
    assert.equal(preview.validRowCount, 0);
    assert.equal(preview.errorRowCount, 3);
    assert.equal(preview.canConfirm, false);
    assert.deepEqual(
      preview.issues.map((issue) => issue.code),
      [
        "DUPLICATE_EMAIL_IN_FILE",
        "DUPLICATE_EMAIL_IN_FILE",
        "ROLE_NOT_ALLOWED",
        "EMAIL_ALREADY_EXISTS",
      ],
    );
  });

  it("validates contacts against tenant location references", async () => {
    const service = new ImportsService({
      location: {
        findMany: async (query: {
          select: { externalCode?: boolean; name?: boolean };
        }) => {
          if (query.select.externalCode) {
            return [{ externalCode: "loc-1" }];
          }

          return [{ name: "ambiguous" }, { name: "ambiguous" }];
        },
      },
    } as never);

    const preview = await service.validateImportPreview(context as never, {
      templateType: "contacts",
      columns: ["location_external_code", "location_name", "name", "email"],
      rows: [
        {
          location_external_code: "LOC-1",
          location_name: "",
          name: "Known Contact",
          email: "known@example.com",
        },
        {
          location_external_code: "MISSING",
          location_name: "",
          name: "Missing Contact",
          email: "missing@example.com",
        },
        {
          location_external_code: "",
          location_name: "Ambiguous",
          name: "Ambiguous Contact",
          email: "not-an-email",
        },
      ],
    });

    assert.equal(preview.rowCount, 3);
    assert.equal(preview.validRowCount, 1);
    assert.equal(preview.errorRowCount, 2);
    assert.deepEqual(
      preview.issues.map((issue) => issue.code),
      ["LOCATION_NOT_FOUND", "EMAIL_INVALID", "LOCATION_AMBIGUOUS"],
    );
  });

  it("stores row issues with the validation job", async () => {
    const createdJobs: unknown[] = [];
    const createdIssues: unknown[] = [];
    const prisma = {
      user: {
        findMany: async () => [],
      },
      $transaction: async (
        callback: (transaction: {
          importJob: { create: (query: unknown) => Promise<{ id: string }> };
          importRowIssue: {
            createMany: (query: { data: unknown[] }) => Promise<void>;
          };
        }) => Promise<{ id: string }>,
      ) =>
        callback({
          importJob: {
            create: async (query: unknown) => {
              createdJobs.push(query);

              return { id: "import-job-a" };
            },
          },
          importRowIssue: {
            createMany: async (query: { data: unknown[] }) => {
              createdIssues.push(...query.data);
            },
          },
        }),
    };

    const service = new ImportsService(prisma as never);
    const storedPreview = await service.createImportValidationJob(
      context as never,
      {
        templateType: "users",
        columns: ["email", "name", "roles"],
        rows: [
          {
            email: "",
            name: "Missing Email",
            roles: "company_admin",
          },
          {
            email: "valid@example.com",
            name: "Valid User",
            roles: "field_representative",
          },
        ],
      },
    );

    assert.equal(storedPreview.importJobId, "import-job-a");
    assert.equal(storedPreview.status, "validation_failed");
    assert.equal(storedPreview.errorRowCount, 1);
    assert.equal(createdJobs.length, 1);
    assert.equal(createdIssues.length, 1);
    assert.deepEqual(createdIssues[0], {
      tenantId: "tenant-a",
      importJobId: "import-job-a",
      rowNumber: 2,
      fieldName: "email",
      severity: "error",
      code: "REQUIRED_FIELD_MISSING",
      message: "Required field is missing.",
      rawValue: "",
    });
  });
});
