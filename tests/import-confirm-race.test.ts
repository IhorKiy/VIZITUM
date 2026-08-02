import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";

import { ImportsService } from "../src/modules/imports/imports.service";

// Confirming an import applies every row in the file. The status check that
// guards it ran outside the transaction, so two confirms of the same job
// could both pass it and both apply — duplicate users, duplicate locations, a
// second set of route plans, from one upload.
describe("import confirm race", () => {
  it("claims the job inside the transaction, so a second confirm applies nothing", async () => {
    const store = createStore();
    const service = new ImportsService(store.prisma as never);

    const first = await service.confirmImportJob(
      { tenantId: "tenant-a", userId: "user-a" } as never,
      "import-job-products",
    );

    assert.equal(first.status, "applied");
    assert.equal(store.createdProducts.length, 2);

    // The second request read the job as still "validated" — that is the race
    // — but the conditional claim inside the transaction matches nothing.
    store.claimSucceeds = false;

    await assert.rejects(
      () =>
        service.confirmImportJob(
          { tenantId: "tenant-a", userId: "user-b" } as never,
          "import-job-products",
        ),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "IMPORT_ALREADY_APPLIED",
        );

        return true;
      },
    );

    // The point of the whole fix: no rows from the second pass.
    assert.equal(store.createdProducts.length, 2);
  });
});

function createStore() {
  const createdProducts: unknown[] = [];
  const store = {
    createdProducts,
    claimSucceeds: true,
    prisma: {
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
              { name: "Product A", external_code: "a", sku: "", category: "" },
              { name: "Product B", external_code: "b", sku: "", category: "" },
            ],
            canConfirm: true,
          },
        }),
      },
      tenantSetting: { findFirst: async () => null },
      product: { findMany: async () => [] },
      $transaction: async (
        callback: (transaction: unknown) => Promise<unknown>,
      ) =>
        callback({
          importJob: {
            updateMany: async () => ({
              count: store.claimSucceeds ? 1 : 0,
            }),
            update: async () => undefined,
          },
          product: {
            create: async (query: unknown) => {
              createdProducts.push(query);
            },
            findMany: async () => [],
          },
        }),
    },
  };

  return store;
}
