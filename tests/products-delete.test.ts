import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";

import { ProductsService } from "../src/modules/products/products.service";
import type { RequestContext } from "../src/modules/tenancy/request-context";

function createContext(tenantId = "tenant-1"): RequestContext {
  return { tenantId } as RequestContext;
}

function createProduct(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    id: "prod-1",
    tenantId: "tenant-1",
    externalCode: null,
    name: "Sparkling Water",
    sku: "SW-500",
    category: "Beverages",
    status: "active",
    notApplicable: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

describe("products service delete", () => {
  it("soft-deletes a tenant product by setting deletedAt", async () => {
    const findWhere: unknown[] = [];
    const updateArgs: { where: unknown; data: Record<string, unknown> }[] = [];
    const events: unknown[] = [];
    const prisma = {
      product: {
        findFirst: async (query: { where: unknown }) => {
          findWhere.push(query.where);
          return createProduct();
        },
      },
      // The delete and its audit trail commit together, so the write arrives
      // on the transaction client rather than on this object.
      $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          product: {
            update: async (query: {
              where: unknown;
              data: Record<string, unknown>;
            }) => {
              updateArgs.push(query);
              return createProduct({ deletedAt: query.data.deletedAt });
            },
          },
        }),
    };
    const service = new ProductsService(
      prisma as never,
      {
        recordEvent: async (
          _context: unknown,
          input: unknown,
          client?: unknown,
        ) => {
          events.push({ input, inTransaction: client !== undefined });
        },
      } as never,
    );

    const result = await service.deleteProduct(
      createContext("tenant-1"),
      "prod-1",
    );

    // Only the request tenant's non-deleted product is targeted.
    assert.deepEqual(findWhere, [
      { id: "prod-1", tenantId: "tenant-1", deletedAt: null },
    ]);
    // Who deleted it, in the same transaction as the delete. The row itself
    // records only when — no `deletedBy` column exists anywhere in the schema
    // (audit F5).
    assert.deepEqual(events, [
      {
        input: {
          entityType: "product",
          entityId: "prod-1",
          eventType: "product.deleted",
        },
        inTransaction: true,
      },
    ]);
    // Update sets deletedAt (soft delete), not a hard row removal.
    assert.equal(updateArgs.length, 1);
    assert.deepEqual(updateArgs[0]?.where, { id: "prod-1" });
    assert.ok(updateArgs[0]?.data.deletedAt instanceof Date);
    assert.deepEqual(result, { deleted: true });
  });

  it("does not delete a product from another tenant", async () => {
    let updateCalled = false;
    const prisma = {
      product: {
        findFirst: async () => null,
        update: async () => {
          updateCalled = true;
          return createProduct();
        },
      },
    };
    const service = new ProductsService(prisma as never);

    await assert.rejects(
      () => service.deleteProduct(createContext("tenant-2"), "prod-1"),
      NotFoundException,
    );
    assert.equal(updateCalled, false);
  });
});
