import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChainsService } from "../src/modules/chains/chains.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "user-a",
  roleCodes: ["company_admin"],
  permissions: [],
};

function chainRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "chain-a",
    tenantId: "tenant-a",
    externalCode: null,
    name: "ATB",
    status: "active",
    notes: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("chains service", () => {
  it("requires a name to create a chain", async () => {
    const service = new ChainsService({
      chain: {
        findFirst: async () => null,
        create: async () => chainRow(),
      },
    } as never);

    await assert.rejects(
      () => service.createChain(context as never, { name: "   " }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "CHAIN_INVALID",
    );
  });

  it("rejects a duplicate chain name case-insensitively", async () => {
    let nameLookupWhere: Record<string, unknown> | undefined;
    const service = new ChainsService({
      chain: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          nameLookupWhere = where;
          return { id: "chain-existing" };
        },
        create: async () => {
          throw new Error("create should not be reached on a name conflict");
        },
      },
    } as never);

    await assert.rejects(
      () => service.createChain(context as never, { name: "atb" }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "CHAIN_NAME_EXISTS",
    );

    assert.deepEqual(nameLookupWhere, {
      tenantId: "tenant-a",
      name: { equals: "atb", mode: "insensitive" },
      deletedAt: null,
    });
  });

  it("scopes a chain listing to the caller's tenant and non-deleted rows", async () => {
    let listWhere: Record<string, unknown> | undefined;
    const service = new ChainsService({
      chain: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          listWhere = where;
          return [chainRow()];
        },
        count: async () => 1,
      },
    } as never);

    const result = await service.listChains(context as never, {});

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].name, "ATB");
    assert.equal(listWhere?.tenantId, "tenant-a");
    assert.equal(listWhere?.deletedAt, null);
  });
});
