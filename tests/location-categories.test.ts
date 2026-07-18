import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { LocationCategoriesService } from "../src/modules/locations/location-categories.service";
import type { RequestContext } from "../src/modules/tenancy/request-context";

function createContext(tenantId = "tenant-1"): RequestContext {
  return { tenantId } as RequestContext;
}

function createCategory(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    id: "cat-1",
    tenantId: "tenant-1",
    name: "Bakery",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("location categories service", () => {
  it("lists only the request tenant's categories, ordered by name", async () => {
    const queries: unknown[] = [];
    const prisma = {
      locationCategory: {
        findMany: async (query: unknown) => {
          queries.push(query);
          return [createCategory()];
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    const result = await service.listCategories(createContext("tenant-1"));

    assert.deepEqual(queries, [
      { where: { tenantId: "tenant-1" }, orderBy: { name: "asc" } },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, "Bakery");
    // Response is serialized (no Date instances leak out).
    assert.equal(typeof result[0]?.createdAt, "string");
  });

  it("rejects a blank category name", async () => {
    const prisma = { locationCategory: {} };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () => service.createCategory(createContext(), { name: "   " }),
      BadRequestException,
    );
  });

  it("trims the name and scopes the create to the request tenant", async () => {
    const created: unknown[] = [];
    const prisma = {
      locationCategory: {
        findFirst: async () => null,
        create: async (query: { data: Record<string, unknown> }) => {
          created.push(query.data);
          return createCategory({ name: query.data.name });
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    const result = await service.createCategory(createContext("tenant-9"), {
      name: "  Convenience Store  ",
    });

    assert.deepEqual(created, [
      { tenantId: "tenant-9", name: "Convenience Store" },
    ]);
    assert.equal(result.name, "Convenience Store");
  });

  it("rejects a duplicate category name within the tenant", async () => {
    const prisma = {
      locationCategory: {
        findFirst: async () => ({ id: "existing" }),
        create: async () => {
          throw new Error("create should not be called");
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () => service.createCategory(createContext(), { name: "Bakery" }),
      ConflictException,
    );
  });

  it("rejects a duplicate that differs only in letter case", async () => {
    const probeWhere: Record<string, unknown>[] = [];
    const prisma = {
      locationCategory: {
        findFirst: async (query: { where: Record<string, unknown> }) => {
          probeWhere.push(query.where);
          return { id: "existing" };
        },
        create: async () => {
          throw new Error("create should not be called");
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () => service.createCategory(createContext(), { name: "bakery" }),
      ConflictException,
    );
    // The duplicate probe compares case-insensitively.
    assert.deepEqual(probeWhere, [
      {
        tenantId: "tenant-1",
        name: { equals: "bakery", mode: "insensitive" },
      },
    ]);
  });

  it("maps a concurrent unique-constraint violation to a conflict", async () => {
    const prisma = {
      locationCategory: {
        // Pre-check passes (no row yet), but a racing insert wins first, so
        // the create hits the functional unique index and Prisma raises P2002.
        findFirst: async () => null,
        create: async () => {
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed",
            { code: "P2002", clientVersion: "test" },
          );
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () => service.createCategory(createContext(), { name: "Bakery" }),
      ConflictException,
    );
  });

  it("renames a category — no cascade needed, Location.categoryId is a real FK", async () => {
    const categoryUpdate: unknown[] = [];
    const prisma = {
      locationCategory: {
        findFirst: async (query: { where: Record<string, unknown> }) =>
          "name" in query.where
            ? null // uniqueness probe: no conflicting name
            : { id: "cat-1", name: "Bakery" },
        update: (query: { where: unknown; data: Record<string, unknown> }) => {
          categoryUpdate.push(query);
          return Promise.resolve(createCategory({ name: query.data.name }));
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    const result = await service.updateCategory(
      createContext("tenant-1"),
      "cat-1",
      { name: "  Pastry Shop  " },
    );

    assert.equal(result.name, "Pastry Shop");
    assert.deepEqual(categoryUpdate, [
      { where: { id: "cat-1" }, data: { name: "Pastry Shop" } },
    ]);
  });

  it("allows recasing a category (self-collision excluded from the probe)", async () => {
    const probeWhere: Record<string, unknown>[] = [];
    const prisma = {
      locationCategory: {
        findFirst: async (query: { where: Record<string, unknown> }) => {
          if ("name" in query.where) {
            probeWhere.push(query.where);
            return null;
          }
          return { id: "cat-1", name: "Bakery" };
        },
        update: (query: { data: Record<string, unknown> }) =>
          Promise.resolve(createCategory({ name: query.data.name })),
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    const result = await service.updateCategory(
      createContext("tenant-1"),
      "cat-1",
      { name: "BAKERY" },
    );

    assert.equal(result.name, "BAKERY");
    assert.deepEqual(probeWhere, [
      {
        tenantId: "tenant-1",
        name: { equals: "BAKERY", mode: "insensitive" },
        id: { not: "cat-1" },
      },
    ]);
  });

  it("rejects renaming a category to a name already in use", async () => {
    const prisma = {
      locationCategory: {
        findFirst: async (query: { where: Record<string, unknown> }) =>
          "name" in query.where
            ? { id: "cat-2" } // a different category already owns the name
            : { id: "cat-1", name: "Bakery" },
        update: async () => {
          throw new Error("update should not be called");
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () =>
        service.updateCategory(createContext("tenant-1"), "cat-1", {
          name: "Pastry Shop",
        }),
      ConflictException,
    );
  });

  it("maps a concurrent unique-constraint violation on rename to a conflict", async () => {
    const prisma = {
      locationCategory: {
        findFirst: async (query: { where: Record<string, unknown> }) =>
          "name" in query.where ? null : { id: "cat-1", name: "Bakery" },
        update: async () => {
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed",
            { code: "P2002", clientVersion: "test" },
          );
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () =>
        service.updateCategory(createContext("tenant-1"), "cat-1", {
          name: "Pastry Shop",
        }),
      ConflictException,
    );
  });

  it("does not rename a category from another tenant", async () => {
    const prisma = {
      locationCategory: {
        findFirst: async () => null,
        update: async () => {
          throw new Error("update should not be called");
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () =>
        service.updateCategory(createContext("tenant-2"), "cat-1", {
          name: "Pastry Shop",
        }),
      NotFoundException,
    );
  });

  it("rejects a blank rename", async () => {
    const prisma = { locationCategory: {} };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () => service.updateCategory(createContext(), "cat-1", { name: "   " }),
      BadRequestException,
    );
  });

  it("only deletes a category owned by the request tenant, when unused", async () => {
    const findWhere: unknown[] = [];
    const countWhere: unknown[] = [];
    const deleteWhere: unknown[] = [];
    const prisma = {
      locationCategory: {
        findFirst: async (query: { where: unknown }) => {
          findWhere.push(query.where);
          return { id: "cat-1" };
        },
        delete: async (query: { where: unknown }) => {
          deleteWhere.push(query.where);
          return createCategory();
        },
      },
      location: {
        count: async (query: { where: unknown }) => {
          countWhere.push(query.where);
          return 0;
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    const result = await service.deleteCategory(
      createContext("tenant-1"),
      "cat-1",
    );

    assert.deepEqual(findWhere, [{ id: "cat-1", tenantId: "tenant-1" }]);
    // The `Restrict` FK blocks the delete regardless of `deletedAt`, so the
    // in-use count must not filter it out — otherwise a category referenced
    // only by archived locations would read as unused here and then fail
    // with a P2003 the pre-check should have caught.
    assert.deepEqual(countWhere, [
      { tenantId: "tenant-1", categoryId: "cat-1" },
    ]);
    assert.deepEqual(deleteWhere, [{ id: "cat-1" }]);
    assert.deepEqual(result, { deleted: true });
  });

  it("does not delete a category from another tenant", async () => {
    let deleteCalled = false;
    const prisma = {
      locationCategory: {
        findFirst: async () => null,
        delete: async () => {
          deleteCalled = true;
          return createCategory();
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () => service.deleteCategory(createContext("tenant-2"), "cat-1"),
      NotFoundException,
    );
    assert.equal(deleteCalled, false);
  });

  it("rejects deleting a category still assigned to locations (409, with the count)", async () => {
    const prisma = {
      locationCategory: {
        findFirst: async () => ({ id: "cat-1" }),
        delete: async () => {
          throw new Error("delete should not be called");
        },
      },
      location: {
        count: async () => 3,
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () => service.deleteCategory(createContext("tenant-1"), "cat-1"),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        const response = error.getResponse() as {
          code: string;
          details?: { locationCount?: number };
        };
        assert.equal(response.code, "LOCATION_CATEGORY_IN_USE");
        assert.equal(response.details?.locationCount, 3);
        return true;
      },
    );
  });

  it("rejects deleting a category referenced only by an archived location (the Restrict FK doesn't care about deletedAt)", async () => {
    const countWhere: unknown[] = [];
    const prisma = {
      locationCategory: {
        findFirst: async () => ({ id: "cat-1" }),
        delete: async () => {
          throw new Error("delete should not be called");
        },
      },
      location: {
        // A real archived location still holds the FK, so the count must
        // see it — this stands in for that row rather than filtering it out.
        count: async (query: { where: unknown }) => {
          countWhere.push(query.where);
          return 1;
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () => service.deleteCategory(createContext("tenant-1"), "cat-1"),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        const response = error.getResponse() as {
          code: string;
          details?: { locationCount?: number };
        };
        assert.equal(response.code, "LOCATION_CATEGORY_IN_USE");
        assert.equal(response.details?.locationCount, 1);
        return true;
      },
    );
    assert.deepEqual(countWhere, [
      { tenantId: "tenant-1", categoryId: "cat-1" },
    ]);
    assert.ok(
      countWhere.every((where) => !Object.hasOwn(where as object, "deletedAt")),
      "the in-use count must not filter out archived locations",
    );
  });

  it("maps a concurrent FK-restrict violation on delete to the same 409", async () => {
    // The in-use pre-check passes (count is 0), but a location is created
    // against this category between the check and the delete, so the
    // `Restrict` FK raises P2003 instead.
    let countCalls = 0;
    const prisma = {
      locationCategory: {
        findFirst: async () => ({ id: "cat-1" }),
        delete: async () => {
          throw new Prisma.PrismaClientKnownRequestError(
            "Foreign key constraint failed",
            { code: "P2003", clientVersion: "test" },
          );
        },
      },
      location: {
        count: async () => {
          countCalls += 1;
          // First call (pre-check) sees 0; second call (post-race recount,
          // used only to report a count in the error) sees the new row.
          return countCalls === 1 ? 0 : 1;
        },
      },
    };
    const service = new LocationCategoriesService(prisma as never);

    await assert.rejects(
      () => service.deleteCategory(createContext("tenant-1"), "cat-1"),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "LOCATION_CATEGORY_IN_USE",
        );
        return true;
      },
    );
  });
});
