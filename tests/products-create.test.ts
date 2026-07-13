import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { ProductsService } from "../src/modules/products/products.service";
import type { RequestContext } from "../src/modules/tenancy/request-context";

function createContext(tenantId = "tenant-1"): RequestContext {
  return { tenantId } as RequestContext;
}

type ProductRow = {
  id: string;
  tenantId: string;
  externalCode: string | null;
  name: string;
  sku: string | null;
  category: string | null;
  status: string;
  notApplicable: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function makeRow(overrides: Partial<ProductRow> = {}): ProductRow {
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

// Minimal prisma stub whose `findFirst` honors the tenantId/externalCode/
// deletedAt filters the service passes, so the soft-delete visibility rule is
// exercised rather than mocked away.
function createPrisma(rows: ProductRow[], createErrors?: Error) {
  let created: ProductRow[] = [];

  return {
    created: () => created,
    product: {
      findFirst: async (query: {
        where: Record<string, unknown>;
        select?: unknown;
      }) => {
        const where = query.where;
        const match = rows.find(
          (row) =>
            (where.tenantId === undefined || row.tenantId === where.tenantId) &&
            (where.externalCode === undefined ||
              row.externalCode === where.externalCode) &&
            (where.deletedAt === undefined ||
              (where.deletedAt === null && row.deletedAt === null)),
        );

        return match ?? null;
      },
      create: async (query: { data: Record<string, unknown> }) => {
        if (createErrors) {
          throw createErrors;
        }

        const row = makeRow({
          id: `prod-created-${created.length + 1}`,
          ...(query.data as Partial<ProductRow>),
        });
        created = [...created, row];

        return row;
      },
    },
  };
}

describe("products service create external code uniqueness", () => {
  it("re-creates a product whose externalCode belongs to a soft-deleted product", async () => {
    // A prior product with externalCode "SKU-9" was soft-deleted (deletedAt set),
    // so its code is free again. The pre-check ignores the soft-deleted row and
    // the create must succeed cleanly (regression: it used to hit the DB unique
    // index and surface a 500).
    const prisma = createPrisma([
      makeRow({
        id: "prod-old",
        externalCode: "SKU-9",
        deletedAt: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ]);
    const service = new ProductsService(prisma as never);

    const result = await service.createProduct(createContext("tenant-1"), {
      name: "Still Water",
      externalCode: "SKU-9",
    });

    assert.equal(result.externalCode, "SKU-9");
    assert.equal(result.name, "Still Water");
    assert.equal(prisma.created().length, 1);
  });

  it("rejects an externalCode already used by a live product", async () => {
    const prisma = createPrisma([
      makeRow({ id: "prod-old", externalCode: "SKU-9", deletedAt: null }),
    ]);
    const service = new ProductsService(prisma as never);

    await assert.rejects(
      () =>
        service.createProduct(createContext("tenant-1"), {
          name: "Still Water",
          externalCode: "SKU-9",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code?: string }).code,
          "PRODUCT_EXTERNAL_CODE_EXISTS",
        );
        return true;
      },
    );
    assert.equal(prisma.created().length, 0);
  });

  it("maps a concurrent unique-constraint violation to a 409, not a 500", async () => {
    // The pre-check passes (no live row seen), but a racing create inserts the
    // same code first, so this insert trips the partial unique index -> P2002.
    // It must surface as the same conflict, not an opaque 500.
    const prisma = createPrisma(
      [],
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const service = new ProductsService(prisma as never);

    await assert.rejects(
      () =>
        service.createProduct(createContext("tenant-1"), {
          name: "Still Water",
          externalCode: "SKU-9",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code?: string }).code,
          "PRODUCT_EXTERNAL_CODE_EXISTS",
        );
        return true;
      },
    );
  });
});
