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

describe("import locations: category resolution", () => {
  it("accepts the legacy 'type' column header as an alias for 'category'", () => {
    const service = new ImportsService();
    const csv = [
      "name,address_line,city,type",
      "Store A,Addr A,Kyiv,Bakery",
      "",
    ].join("\n");

    const parsed = service.parseApprovedCsvTemplate("locations", csv);

    assert.deepEqual(parsed.columns, [
      "name",
      "address_line",
      "city",
      "category",
    ]);
    assert.equal(parsed.rows[0]?.category, "Bakery");
    assert.equal(parsed.rows[0]?.type, undefined);
  });

  it("surfaces a warning that new categories will be created, deduped case-insensitively, without blocking confirm", async () => {
    const service = new ImportsService({
      location: {
        findMany: async () => [],
      },
      user: {
        findMany: async () => [],
      },
      locationCategory: {
        findMany: async () => [{ name: "Warehouse" }],
      },
    } as never);

    const preview = await service.validateImportPreview(context as never, {
      templateType: "locations",
      columns: ["name", "address_line", "city", "category"],
      rows: [
        {
          name: "Store A",
          address_line: "Addr A",
          city: "Kyiv",
          category: "Bakery",
        },
        {
          name: "Store B",
          address_line: "Addr B",
          city: "Lviv",
          category: "bakery",
        },
        {
          name: "Store C",
          address_line: "Addr C",
          city: "Odesa",
          category: "Warehouse",
        },
      ],
    });

    assert.equal(preview.canConfirm, true);
    assert.equal(preview.errorRowCount, 0);

    const categoryIssues = preview.issues.filter(
      (issue) => issue.code === "LOCATION_CATEGORY_WILL_BE_CREATED",
    );

    // Only "Bakery" is new — "bakery" on row 3 is the same category
    // case-insensitively, so it does not get a second warning; "Warehouse"
    // already exists and gets none at all.
    assert.equal(categoryIssues.length, 1);
    assert.equal(categoryIssues[0]?.rowNumber, 2);
    assert.equal(categoryIssues[0]?.rawValue, "Bakery");
  });

  it("auto-creates new categories and reuses existing ones case-insensitively, deduping within the file", async () => {
    const categoryRows: { id: string; tenantId: string; name: string }[] = [
      { id: "cat-warehouse", tenantId: "tenant-a", name: "Warehouse" },
    ];
    let nextId = 1;
    const createdLocations: { categoryId: string | null }[] = [];
    const prisma = {
      importJob: {
        findFirst: async () => ({
          id: "import-job-locations",
          type: "locations",
          status: "validated",
          errorRowCount: 0,
          summary: {
            templateType: "locations",
            columns: ["name", "address_line", "city", "category"],
            rows: [
              {
                name: "Store A",
                address_line: "Addr A",
                city: "Kyiv",
                category: "Bakery",
              },
              {
                name: "Store B",
                address_line: "Addr B",
                city: "Lviv",
                category: "bakery",
              },
              {
                name: "Store C",
                address_line: "Addr C",
                city: "Odesa",
                category: "Warehouse",
              },
            ],
            canConfirm: true,
          },
        }),
      },
      $transaction: async (
        callback: (tx: unknown) => Promise<unknown>,
      ) =>
        callback({
          locationCategory: {
            findFirst: async ({
              where,
            }: {
              where: {
                tenantId: string;
                name: { equals: string; mode: string };
              };
            }) => {
              const match = categoryRows.find(
                (row) =>
                  row.tenantId === where.tenantId &&
                  row.name.toLowerCase() === where.name.equals.toLowerCase(),
              );

              return match ? { id: match.id } : null;
            },
            create: async ({
              data,
            }: {
              data: { tenantId: string; name: string };
            }) => {
              const row = {
                id: `cat-new-${nextId++}`,
                tenantId: data.tenantId,
                name: data.name,
              };

              categoryRows.push(row);

              return { id: row.id };
            },
          },
          location: {
            create: async ({
              data,
            }: {
              data: { categoryId: string | null };
            }) => {
              createdLocations.push(data);

              return { id: `location-${createdLocations.length}` };
            },
          },
          importJob: {
            update: async () => undefined,
            // The conditional claim confirm makes before applying any row.
            updateMany: async () => ({ count: 1 }),
          },
        }),
    };

    const service = new ImportsService(prisma as never);
    const result = await service.confirmImportJob(
      context as never,
      "import-job-locations",
    );

    // Only "Bakery" is genuinely new — "Warehouse" already existed.
    assert.equal(result.createdCounts.locationCategories, 1);
    assert.equal(result.createdCounts.locations, 3);

    const categoryIds = createdLocations.map((location) => location.categoryId);

    assert.equal(categoryIds[0], categoryIds[1]);
    assert.notEqual(categoryIds[0], categoryIds[2]);
    assert.equal(categoryIds[2], "cat-warehouse");

    // The newly created category preserves the first-seen casing exactly as
    // typed, unlike resolveChainReference's lowercased auto-created chains.
    const newCategory = categoryRows.find((row) => row.id === categoryIds[0]);
    assert.equal(newCategory?.name, "Bakery");
  });
});
