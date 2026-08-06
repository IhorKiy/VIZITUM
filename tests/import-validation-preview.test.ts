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
      platformTenant: {
        findUniqueOrThrow: async () => ({ phoneCountry: "UA" }),
      },
      user: {
        findMany: async () => [{ email: "existing@example.com" }],
      },
    } as never);

    const preview = await service.validateImportPreview(context as never, {
      templateType: "users",
      columns: ["email", "first_name", "last_name", "roles"],
      rows: [
        {
          email: "new@example.com",
          first_name: "New",
          last_name: "User",
          roles: "company_admin",
        },
        {
          email: "new@example.com",
          first_name: "Duplicate",
          last_name: "User",
          roles: "unknown_role",
        },
        {
          email: "existing@example.com",
          first_name: "Existing",
          last_name: "User",
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

  it("flags invalid phones with per-row errors and accepts national and international numbers", async () => {
    const service = new ImportsService({
      platformTenant: {
        findUniqueOrThrow: async () => ({ phoneCountry: "UA" }),
      },
      user: {
        findMany: async () => [],
      },
    } as never);

    const preview = await service.validateImportPreview(context as never, {
      templateType: "users",
      columns: ["email", "first_name", "last_name", "roles", "phone"],
      rows: [
        {
          email: "national@example.com",
          first_name: "National",
          last_name: "Phone",
          roles: "field_representative",
          phone: "067 123 45 67",
        },
        {
          email: "international@example.com",
          first_name: "International",
          last_name: "Phone",
          roles: "field_representative",
          phone: "+49 30 901820",
        },
        {
          email: "bad@example.com",
          first_name: "Bad",
          last_name: "Phone",
          roles: "field_representative",
          phone: "not a phone",
        },
        {
          email: "empty@example.com",
          first_name: "No",
          last_name: "Phone",
          roles: "field_representative",
          phone: "",
        },
      ],
    });

    assert.equal(preview.rowCount, 4);
    assert.equal(preview.errorRowCount, 1);
    assert.deepEqual(
      preview.issues.map((issue) => [issue.rowNumber, issue.code]),
      [[4, "PHONE_INVALID"]],
    );
  });

  it("flags national phones as errors when the tenant has no phone country", async () => {
    const service = new ImportsService({
      platformTenant: {
        findUniqueOrThrow: async () => ({ phoneCountry: null }),
      },
      user: {
        findMany: async () => [],
      },
    } as never);

    const preview = await service.validateImportPreview(context as never, {
      templateType: "users",
      columns: ["email", "first_name", "last_name", "roles", "phone"],
      rows: [
        {
          email: "national@example.com",
          first_name: "National",
          last_name: "Phone",
          roles: "field_representative",
          phone: "067 123 45 67",
        },
      ],
    });

    assert.deepEqual(
      preview.issues.map((issue) => issue.code),
      ["PHONE_INVALID"],
    );
  });

  it("validates contacts against tenant location references", async () => {
    const service = new ImportsService({
      platformTenant: {
        findUniqueOrThrow: async () => ({ phoneCountry: "UA" }),
      },
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
      platformTenant: {
        findUniqueOrThrow: async () => ({ phoneCountry: "UA" }),
      },
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
        columns: ["email", "first_name", "last_name", "roles"],
        rows: [
          {
            email: "",
            first_name: "Missing",
            last_name: "Email",
            roles: "company_admin",
          },
          {
            email: "valid@example.com",
            first_name: "Valid",
            last_name: "User",
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

  it("returns stored row issues for a validation job", async () => {
    const service = new ImportsService({
      importJob: {
        findFirst: async (query: unknown) => {
          assert.deepEqual(query, {
            where: {
              id: "import-job-a",
              tenantId: "tenant-a",
            },
            include: {
              issues: {
                orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }],
              },
            },
          });

          return {
            id: "import-job-a",
            type: "users",
            status: "validation_failed",
            rowCount: 2,
            validRowCount: 1,
            errorRowCount: 1,
            warningRowCount: 0,
            issues: [
              {
                rowNumber: 2,
                fieldName: "email",
                severity: "error",
                code: "REQUIRED_FIELD_MISSING",
                message: "Required field is missing.",
                rawValue: "",
              },
            ],
          };
        },
      },
    } as never);

    const preview = await service.getImportValidationJob(
      context as never,
      "import-job-a",
    );

    assert.equal(preview.importJobId, "import-job-a");
    assert.equal(preview.status, "validation_failed");
    assert.equal(preview.canConfirm, false);
    assert.deepEqual(preview.issues, [
      {
        rowNumber: 2,
        fieldName: "email",
        severity: "error",
        code: "REQUIRED_FIELD_MISSING",
        message: "Required field is missing.",
        rawValue: "",
      },
    ]);
  });

  it("lists recent import jobs for the current tenant", async () => {
    const service = new ImportsService({
      importJob: {
        findMany: async (query: unknown) => {
          assert.deepEqual(query, {
            where: {
              tenantId: "tenant-a",
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 10,
            include: {
              uploadedBy: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                },
              },
              confirmedBy: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                },
              },
            },
          });

          return [
            {
              id: "import-job-applied",
              type: "users",
              status: "applied",
              rowCount: 2,
              validRowCount: 2,
              errorRowCount: 0,
              warningRowCount: 0,
              uploadedBy: {
                id: "user-a",
                email: "admin@example.com",
                name: "Admin User",
              },
              confirmedBy: {
                id: "user-b",
                email: "manager@example.com",
                name: "Manager User",
              },
              summary: {
                appliedCounts: {
                  users: 2,
                  userRoles: 3,
                },
              },
              createdAt: new Date("2026-07-03T10:00:00.000Z"),
              validatedAt: new Date("2026-07-03T10:01:00.000Z"),
              confirmedAt: new Date("2026-07-03T10:02:00.000Z"),
              appliedAt: new Date("2026-07-03T10:03:00.000Z"),
              failedAt: null,
            },
            {
              id: "import-job-failed-validation",
              type: "locations",
              status: "validation_failed",
              rowCount: 1,
              validRowCount: 0,
              errorRowCount: 1,
              warningRowCount: 0,
              uploadedBy: {
                id: "user-a",
                email: "admin@example.com",
                name: "Admin User",
              },
              confirmedBy: null,
              summary: {
                canConfirm: false,
              },
              createdAt: new Date("2026-07-03T09:00:00.000Z"),
              validatedAt: new Date("2026-07-03T09:01:00.000Z"),
              confirmedAt: null,
              appliedAt: null,
              failedAt: null,
            },
          ];
        },
      },
    } as never);

    const jobs = await service.listImportJobs(context as never);

    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].id, "import-job-applied");
    assert.deepEqual(jobs[0].createdCounts, {
      users: 2,
      userRoles: 3,
      chains: 0,
      locationCategories: 0,
      locations: 0,
      locationAssignments: 0,
      contacts: 0,
      products: 0,
      routePlans: 0,
      routeItems: 0,
      tasks: 0,
    });
    assert.equal(jobs[1].createdCounts, null);
  });

  it("applies a validated import in one transaction", async () => {
    const createManyCalls: unknown[][] = [];
    const updatedJobs: unknown[] = [];
    const prisma = {
      importJob: {
        findFirst: async () => ({
          id: "import-job-products",
          type: "products",
          status: "validated",
          errorRowCount: 0,
          summary: {
            templateType: "products",
            columns: ["name", "external_code", "sku", "category"],
            rows: [
              {
                name: "Product A",
                external_code: "prod-a",
                sku: "SKU-A",
                category: "Category A",
              },
              {
                name: "Product B",
                external_code: "",
                sku: "",
                category: "",
              },
            ],
            canConfirm: true,
          },
        }),
      },
      $transaction: async (
        callback: (transaction: {
          product: {
            createMany: (query: {
              data: unknown[];
            }) => Promise<{ count: number }>;
          };
          importJob: {
            update: (query: unknown) => Promise<void>;
            updateMany: (query: unknown) => Promise<{ count: number }>;
          };
        }) => Promise<unknown>,
      ) =>
        callback({
          product: {
            // One batched insert for the whole file, not one call a row — the
            // shape audit F8 asked for, so the apply's query count no longer
            // scales with the row count.
            createMany: async ({ data }: { data: unknown[] }) => {
              createManyCalls.push(data);

              return { count: data.length };
            },
          },
          importJob: {
            update: async (query: unknown) => {
              updatedJobs.push(query);
            },
            // The conditional claim that makes a concurrent second confirm
            // lose — pinned in tests/import-confirm-race.test.ts.
            updateMany: async () => ({ count: 1 }),
          },
        }),
    };

    const service = new ImportsService(prisma as never);
    const result = await service.confirmImportJob(
      context as never,
      "import-job-products",
    );

    assert.equal(result.status, "applied");
    assert.equal(result.appliedRowCount, 2);
    assert.equal(result.createdCounts.products, 2);
    assert.equal(createManyCalls.length, 1);
    assert.equal(createManyCalls[0]?.length, 2);
    assert.equal(updatedJobs.length, 1);
    assert.deepEqual(createManyCalls[0]?.[0], {
      tenantId: "tenant-a",
      externalCode: "prod-a",
      name: "Product A",
      sku: "SKU-A",
      category: "Category A",
    });
  });

  it("does not mark an import applied when row application fails", async () => {
    const createdProducts: unknown[] = [];
    const updatedJobs: unknown[] = [];
    const prisma = {
      importJob: {
        findFirst: async () => ({
          id: "import-job-products",
          type: "products",
          status: "validated",
          errorRowCount: 0,
          summary: {
            templateType: "products",
            columns: ["name", "external_code", "sku", "category"],
            rows: [
              {
                name: "Product A",
                external_code: "prod-a",
                sku: "SKU-A",
                category: "Category A",
              },
              {
                name: "Product B",
                external_code: "prod-b",
                sku: "SKU-B",
                category: "Category B",
              },
            ],
            canConfirm: true,
          },
        }),
      },
      $transaction: async (
        callback: (transaction: {
          product: {
            createMany: (query: {
              data: unknown[];
            }) => Promise<{ count: number }>;
          };
          importJob: {
            update: (query: unknown) => Promise<void>;
            updateMany: (query: unknown) => Promise<{ count: number }>;
          };
        }) => Promise<unknown>,
      ) =>
        callback({
          product: {
            createMany: async ({ data }: { data: unknown[] }) => {
              createdProducts.push(...data);

              throw new Error("Simulated product write failure.");
            },
          },
          importJob: {
            update: async (query: unknown) => {
              updatedJobs.push(query);
            },
            // The conditional claim that makes a concurrent second confirm
            // lose — pinned in tests/import-confirm-race.test.ts.
            updateMany: async () => ({ count: 1 }),
          },
        }),
    };

    const service = new ImportsService(prisma as never);

    await assert.rejects(
      () => service.confirmImportJob(context as never, "import-job-products"),
      /Simulated product write failure/,
    );
    assert.equal(createdProducts.length, 2);
    assert.equal(updatedJobs.length, 0);
  });
});
