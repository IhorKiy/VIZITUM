import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

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

  it("rejects a duplicate that differs only in letter case", async () => {
    const probeWhere: Record<string, unknown>[] = [];
    const prisma = {
      productCategory: {
        findFirst: async (query: { where: Record<string, unknown> }) => {
          probeWhere.push(query.where);
          return { id: "existing" };
        },
        create: async () => {
          throw new Error("create should not be called");
        },
      },
    };
    const service = new ProductCategoriesService(prisma as never);

    await assert.rejects(
      () => service.createCategory(createContext(), { name: "beverages" }),
      ConflictException,
    );
    // The duplicate probe compares case-insensitively.
    assert.deepEqual(probeWhere, [
      {
        tenantId: "tenant-1",
        name: { equals: "beverages", mode: "insensitive" },
      },
    ]);
  });

  it("maps a concurrent unique-constraint violation to a conflict", async () => {
    const prisma = {
      productCategory: {
        // Pre-check passes (no row yet), but a racing insert wins first, so the
        // create hits the @@unique index and Prisma raises P2002.
        findFirst: async () => null,
        create: async () => {
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed",
            { code: "P2002", clientVersion: "test" },
          );
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

  it("renames a category and cascades the new name to its products", async () => {
    const categoryUpdate: unknown[] = [];
    const productUpdateMany: unknown[] = [];
    const prisma = {
      productCategory: {
        findFirst: async (query: { where: Record<string, unknown> }) =>
          "name" in query.where
            ? null // uniqueness probe: no conflicting name
            : { id: "cat-1", name: "Beverages" },
        update: (query: { where: unknown; data: Record<string, unknown> }) => {
          categoryUpdate.push(query);
          return Promise.resolve(createCategory({ name: query.data.name }));
        },
      },
      product: {
        updateMany: (query: { where: unknown; data: unknown }) => {
          productUpdateMany.push(query);
          return Promise.resolve({ count: 3 });
        },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    const service = new ProductCategoriesService(prisma as never);

    const result = await service.updateCategory(
      createContext("tenant-1"),
      "cat-1",
      { name: "  Drinks  " },
    );

    assert.equal(result.name, "Drinks");
    assert.deepEqual(categoryUpdate, [
      { where: { id: "cat-1" }, data: { name: "Drinks" } },
    ]);
    // Existing products tagged with any case variant of the old name are
    // relabelled to the new canonical display name.
    assert.deepEqual(productUpdateMany, [
      {
        where: {
          tenantId: "tenant-1",
          category: { equals: "Beverages", mode: "insensitive" },
        },
        data: { category: "Drinks" },
      },
    ]);
  });

  it("allows recasing a category and cascades the new display name", async () => {
    const probeWhere: Record<string, unknown>[] = [];
    const productUpdateMany: { where: unknown; data: unknown }[] = [];
    const prisma = {
      productCategory: {
        findFirst: async (query: { where: Record<string, unknown> }) => {
          if ("name" in query.where) {
            probeWhere.push(query.where);
            // No *other* category owns this name (self is excluded).
            return null;
          }
          return { id: "cat-1", name: "Beverages" };
        },
        update: (query: { data: Record<string, unknown> }) =>
          Promise.resolve(createCategory({ name: query.data.name })),
      },
      product: {
        updateMany: (query: { where: unknown; data: unknown }) => {
          productUpdateMany.push(query);
          return Promise.resolve({ count: 2 });
        },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    const service = new ProductCategoriesService(prisma as never);

    const result = await service.updateCategory(
      createContext("tenant-1"),
      "cat-1",
      { name: "BEVERAGES" },
    );

    assert.equal(result.name, "BEVERAGES");
    // The sibling-collision probe compares case-insensitively and excludes self.
    assert.deepEqual(probeWhere, [
      {
        tenantId: "tenant-1",
        name: { equals: "BEVERAGES", mode: "insensitive" },
        id: { not: "cat-1" },
      },
    ]);
    assert.deepEqual(productUpdateMany, [
      {
        where: {
          tenantId: "tenant-1",
          category: { equals: "Beverages", mode: "insensitive" },
        },
        data: { category: "BEVERAGES" },
      },
    ]);
  });

  it("rejects renaming a category to a name already in use", async () => {
    const prisma = {
      productCategory: {
        findFirst: async (query: { where: Record<string, unknown> }) =>
          "name" in query.where
            ? { id: "cat-2" } // a different category already owns the name
            : { id: "cat-1", name: "Beverages" },
        update: async () => {
          throw new Error("update should not be called");
        },
      },
    };
    const service = new ProductCategoriesService(prisma as never);

    await assert.rejects(
      () =>
        service.updateCategory(createContext("tenant-1"), "cat-1", {
          name: "Snacks",
        }),
      ConflictException,
    );
  });

  it("maps a concurrent unique-constraint violation on rename to a conflict", async () => {
    const prisma = {
      productCategory: {
        // Uniqueness probe passes, but the rename transaction loses the race
        // to a concurrent insert/rename claiming the same name.
        findFirst: async (query: { where: Record<string, unknown> }) =>
          "name" in query.where ? null : { id: "cat-1", name: "Beverages" },
        update: () => ({}),
      },
      product: { updateMany: () => ({}) },
      $transaction: async () => {
        throw new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed",
          { code: "P2002", clientVersion: "test" },
        );
      },
    };
    const service = new ProductCategoriesService(prisma as never);

    await assert.rejects(
      () =>
        service.updateCategory(createContext("tenant-1"), "cat-1", {
          name: "Drinks",
        }),
      ConflictException,
    );
  });

  it("does not rename a category from another tenant", async () => {
    const prisma = {
      productCategory: {
        findFirst: async () => null,
        update: async () => {
          throw new Error("update should not be called");
        },
      },
    };
    const service = new ProductCategoriesService(prisma as never);

    await assert.rejects(
      () =>
        service.updateCategory(createContext("tenant-2"), "cat-1", {
          name: "Drinks",
        }),
      NotFoundException,
    );
  });

  it("rejects a blank rename", async () => {
    const prisma = { productCategory: {} };
    const service = new ProductCategoriesService(prisma as never);

    await assert.rejects(
      () =>
        service.updateCategory(createContext(), "cat-1", { name: "   " }),
      BadRequestException,
    );
  });
});
