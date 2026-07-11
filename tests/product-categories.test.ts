import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

import { ProductCategoriesService } from "../src/modules/products/product-categories.service";
import type { RequestContext } from "../src/modules/tenancy/request-context";

function createContext(tenantId = "tenant-1"): RequestContext {
  return { tenantId } as RequestContext;
}

function createCategory(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    id: "cat-1",
    tenantId: "tenant-1",
    name: "Beverages",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("product categories service", () => {
  it("lists only the request tenant's categories, ordered by name", async () => {
    const queries: unknown[] = [];
    const prisma = {
      productCategory: {
        findMany: async (query: unknown) => {
          queries.push(query);
          return [createCategory()];
        },
      },
    };
    const service = new ProductCategoriesService(prisma as never);

    const result = await service.listCategories(createContext("tenant-1"));

    assert.deepEqual(queries, [
      { where: { tenantId: "tenant-1" }, orderBy: { name: "asc" } },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, "Beverages");
    // Response is serialized (no Date instances leak out).
    assert.equal(typeof result[0]?.createdAt, "string");
  });

  it("rejects a blank category name", async () => {
    const prisma = { productCategory: {} };
    const service = new ProductCategoriesService(prisma as never);

    await assert.rejects(
      () => service.createCategory(createContext(), { name: "   " }),
      BadRequestException,
    );
  });

  it("trims the name and scopes the create to the request tenant", async () => {
    const created: unknown[] = [];
    const prisma = {
      productCategory: {
        findFirst: async () => null,
        create: async (query: { data: Record<string, unknown> }) => {
          created.push(query.data);
          return createCategory({ name: query.data.name });
        },
      },
    };
    const service = new ProductCategoriesService(prisma as never);

    const result = await service.createCategory(createContext("tenant-9"), {
      name: "  Snacks  ",
    });

    assert.deepEqual(created, [{ tenantId: "tenant-9", name: "Snacks" }]);
    assert.equal(result.name, "Snacks");
  });

  it("rejects a duplicate category name within the tenant", async () => {
    const prisma = {
      productCategory: {
        findFirst: async () => ({ id: "existing" }),
        create: async () => {
          throw new Error("create should not be called");
        },
      },
    };
    const service = new ProductCategoriesService(prisma as never);

    await assert.rejects(
      () => service.createCategory(createContext(), { name: "Beverages" }),
      ConflictException,
    );
  });

  it("only deletes a category owned by the request tenant", async () => {
    const findWhere: unknown[] = [];
    const deleteWhere: unknown[] = [];
    const prisma = {
      productCategory: {
        findFirst: async (query: { where: unknown }) => {
          findWhere.push(query.where);
          return { id: "cat-1" };
        },
        delete: async (query: { where: unknown }) => {
          deleteWhere.push(query.where);
          return createCategory();
        },
      },
    };
    const service = new ProductCategoriesService(prisma as never);

    const result = await service.deleteCategory(
      createContext("tenant-1"),
      "cat-1",
    );

    assert.deepEqual(findWhere, [{ id: "cat-1", tenantId: "tenant-1" }]);
    assert.deepEqual(deleteWhere, [{ id: "cat-1" }]);
    assert.deepEqual(result, { deleted: true });
  });

  it("does not delete a category from another tenant", async () => {
    let deleteCalled = false;
    const prisma = {
      productCategory: {
        findFirst: async () => null,
        delete: async () => {
          deleteCalled = true;
          return createCategory();
        },
      },
    };
    const service = new ProductCategoriesService(prisma as never);

    await assert.rejects(
      () => service.deleteCategory(createContext("tenant-2"), "cat-1"),
      NotFoundException,
    );
    assert.equal(deleteCalled, false);
  });
});
