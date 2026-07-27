import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyShelfCheck,
  extractShelfCheck,
} from "../src/modules/visits/shelf-check";

const confirmedAt = new Date("2026-07-27T09:30:00.000Z");

function buildFieldReport(overrides: Record<string, unknown> = {}) {
  return {
    summary: "",
    fieldReport: {
      visitDate: "2026-07-25",
      shelfChecked: true,
      productUpdates: [{ productId: "product-b", status: "out_of_stock" }],
      ...overrides,
    },
  };
}

function buildTx(requiredProductIds: string[]) {
  const updates: {
    productIds: string[];
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  }[] = [];
  const queries: unknown[] = [];

  return {
    updates,
    queries,
    tx: {
      locationAssortment: {
        findMany: async (query: { where: unknown }) => {
          queries.push(query.where);

          return requiredProductIds.map((productId) => ({ productId }));
        },
        updateMany: async (query: {
          where: { productId: { in: string[] } } & Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          updates.push({
            productIds: query.where.productId.in,
            data: query.data,
            where: query.where,
          });

          return { count: query.where.productId.in.length };
        },
      },
    },
  };
}

describe("extractShelfCheck", () => {
  // The whole point of the explicit flag: an empty tap list means "no gaps"
  // only when the rep said they looked. Inferring it would mark a location's
  // entire matrix in stock off the back of a visit nobody audited.
  it("returns null when the rep did not confirm the shelf check", async () => {
    assert.equal(
      extractShelfCheck(
        buildFieldReport({ shelfChecked: false }) as never,
        confirmedAt,
      ),
      null,
    );
    assert.equal(
      extractShelfCheck(
        buildFieldReport({ shelfChecked: undefined }) as never,
        confirmedAt,
      ),
      null,
    );
  });

  it("returns null for a report that carries no field report at all", () => {
    assert.equal(
      extractShelfCheck({ summary: "manual note" } as never, confirmedAt),
      null,
    );
    assert.equal(
      extractShelfCheck({ fieldReport: "not-an-object" } as never, confirmedAt),
      null,
    );
  });

  it("collects the marked-absent product ids and the visit date", () => {
    const shelfCheck = extractShelfCheck(
      buildFieldReport() as never,
      confirmedAt,
    );

    assert.deepEqual(shelfCheck?.missingProductIds, ["product-b"]);
    assert.deepEqual(
      shelfCheck?.checkedAt,
      new Date("2026-07-25T00:00:00.000Z"),
    );
  });

  it("confirms an empty shelf check — nothing missing is a real answer", () => {
    const shelfCheck = extractShelfCheck(
      buildFieldReport({ productUpdates: [] }) as never,
      confirmedAt,
    );

    assert.deepEqual(shelfCheck?.missingProductIds, []);
  });

  // confirmedData below the top level is unvalidated JSON: a malformed entry
  // must not take the confirm down, and must not be read as a product id.
  it("ignores malformed product updates", () => {
    const shelfCheck = extractShelfCheck(
      buildFieldReport({
        productUpdates: [
          { productId: "product-b", status: "out_of_stock" },
          { productId: "", status: "out_of_stock" },
          { productId: 42, status: "out_of_stock" },
          { productId: "product-c", status: "in_stock" },
          "not-an-object",
          null,
        ],
      }) as never,
      confirmedAt,
    );

    assert.deepEqual(shelfCheck?.missingProductIds, ["product-b"]);
  });

  it("falls back to the confirmation time when the visit date is unusable", () => {
    for (const visitDate of ["not-a-date", "2026-02-31", 20260725, null]) {
      const shelfCheck = extractShelfCheck(
        buildFieldReport({ visitDate }) as never,
        confirmedAt,
      );

      assert.deepEqual(shelfCheck?.checkedAt, confirmedAt);
    }
  });
});

describe("applyShelfCheck", () => {
  it("marks unmarked required products in stock and marked ones out of stock", async () => {
    const { tx, updates } = buildTx(["product-a", "product-b", "product-c"]);

    await applyShelfCheck(tx as never, "tenant-a", "location-a", {
      missingProductIds: ["product-b"],
      checkedAt: new Date("2026-07-25T00:00:00.000Z"),
    });

    assert.equal(updates.length, 2);
    assert.deepEqual(updates[0]?.productIds, ["product-a", "product-c"]);
    assert.deepEqual(updates[0]?.data, {
      status: "in_stock",
      lastCheckedAt: new Date("2026-07-25T00:00:00.000Z"),
    });
    assert.deepEqual(updates[1]?.productIds, ["product-b"]);
    assert.deepEqual(updates[1]?.data, {
      status: "out_of_stock",
      lastCheckedAt: new Date("2026-07-25T00:00:00.000Z"),
    });
  });

  // The matrix is the manager's, read fresh at confirm time rather than
  // trusted from the report: a product marked missing but no longer required
  // has no row to write, and must not be resurrected as one.
  it("only touches rows that are still required, scoped to tenant and location", async () => {
    const { tx, updates, queries } = buildTx(["product-a"]);

    await applyShelfCheck(tx as never, "tenant-a", "location-a", {
      missingProductIds: ["product-removed-from-matrix"],
      checkedAt: confirmedAt,
    });

    assert.deepEqual(queries[0], {
      tenantId: "tenant-a",
      locationId: "location-a",
      shouldBeListed: true,
      product: { deletedAt: null },
    });
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0]?.productIds, ["product-a"]);
    assert.equal(updates[0]?.data.status, "in_stock");
  });

  // Reports are confirmed whenever the rep gets to them, not in visit order,
  // and `visitDate` is client-supplied — so a stale confirmation must not be
  // able to reinstate an older shelf or walk `lastCheckedAt` backwards.
  it("refuses to overwrite a row already checked more recently", async () => {
    const { tx, updates } = buildTx(["product-a", "product-b"]);

    await applyShelfCheck(tx as never, "tenant-a", "location-a", {
      missingProductIds: ["product-b"],
      checkedAt: new Date("2026-07-20T00:00:00.000Z"),
    });

    for (const update of updates) {
      assert.deepEqual(update.where.OR, [
        { lastCheckedAt: null },
        { lastCheckedAt: { lte: new Date("2026-07-20T00:00:00.000Z") } },
      ]);
    }
  });

  it("writes nothing when the location has no required rows", async () => {
    const { tx, updates } = buildTx([]);

    await applyShelfCheck(tx as never, "tenant-a", "location-a", {
      missingProductIds: [],
      checkedAt: confirmedAt,
    });

    assert.equal(updates.length, 0);
  });

  // shouldBeListed is the manager's half of the row and is never written from
  // here — a shelf check reports on the matrix, it does not edit it.
  it("never writes the matrix flag", async () => {
    const { tx, updates } = buildTx(["product-a", "product-b"]);

    await applyShelfCheck(tx as never, "tenant-a", "location-a", {
      missingProductIds: ["product-b"],
      checkedAt: confirmedAt,
    });

    for (const update of updates) {
      assert.equal("shouldBeListed" in update.data, false);
      assert.deepEqual(Object.keys(update.data).sort(), [
        "lastCheckedAt",
        "status",
      ]);
    }
  });
});
