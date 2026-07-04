import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

import { PlatformService } from "../src/modules/platform/platform.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";

describe("platform tenant management", () => {
  it("updates editable fields and records a tenant.updated event", async () => {
    const store = createStore({
      id: "tenant-1",
      status: "ready",
      name: "Old Name",
      planCode: "pilot",
    });
    const service = new PlatformService(store.prisma as unknown as PrismaService);

    const updated = await service.updateTenant("tenant-1", {
      name: "  New Name  ",
      status: "active",
      actorUserId: "owner-1",
    });

    assert.equal(updated.name, "New Name");
    assert.equal(updated.status, "active");
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.updated");
    assert.deepEqual(store.events[0]?.metadata, { fields: ["name", "status"] });
  });

  it("rejects setting status to archived through update", async () => {
    const store = createStore({ id: "tenant-1", status: "ready" });
    const service = new PlatformService(store.prisma as unknown as PrismaService);

    await assert.rejects(
      () => service.updateTenant("tenant-1", { status: "archived" as never }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "TENANT_UPDATE_INVALID");
        assert.ok(response.fieldErrors.status);
        return true;
      },
    );
    assert.equal(store.events.length, 0);
  });

  it("rejects an empty update payload", async () => {
    const store = createStore({ id: "tenant-1", status: "ready" });
    const service = new PlatformService(store.prisma as unknown as PrismaService);

    await assert.rejects(
      () => service.updateTenant("tenant-1", {}),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TENANT_UPDATE_EMPTY",
        );
        return true;
      },
    );
  });

  it("rejects updating an unknown tenant", async () => {
    const store = createStore({ id: "tenant-1", status: "ready" });
    const service = new PlatformService(store.prisma as unknown as PrismaService);

    await assert.rejects(
      () => service.updateTenant("missing", { name: "X" }),
      NotFoundException,
    );
  });

  it("rejects updating an archived tenant", async () => {
    const store = createStore({ id: "tenant-1", status: "archived" });
    const service = new PlatformService(store.prisma as unknown as PrismaService);

    await assert.rejects(
      () => service.updateTenant("tenant-1", { name: "X" }),
      ConflictException,
    );
  });

  it("archives a tenant and records a tenant.archived event", async () => {
    const store = createStore({ id: "tenant-1", status: "active" });
    const service = new PlatformService(store.prisma as unknown as PrismaService);

    const archived = await service.archiveTenant("tenant-1", {
      actorUserId: "owner-1",
    });

    assert.equal(archived.status, "archived");
    assert.ok(archived.archivedAt instanceof Date);
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.archived");
    assert.deepEqual(store.events[0]?.metadata, { previousStatus: "active" });
  });

  it("is idempotent when archiving an already-archived tenant", async () => {
    const store = createStore({ id: "tenant-1", status: "archived" });
    const service = new PlatformService(store.prisma as unknown as PrismaService);

    const result = await service.archiveTenant("tenant-1");

    assert.equal(result.status, "archived");
    assert.equal(store.events.length, 0);
  });

  it("rejects archiving an unknown tenant", async () => {
    const store = createStore({ id: "tenant-1", status: "active" });
    const service = new PlatformService(store.prisma as unknown as PrismaService);

    await assert.rejects(
      () => service.archiveTenant("missing"),
      NotFoundException,
    );
  });
});

function createStore(seed: Record<string, unknown> & { id: string }) {
  const tenant: Record<string, unknown> = { archivedAt: null, ...seed };
  const events: Array<Record<string, unknown>> = [];

  const client = {
    platformTenant: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === tenant.id ? { ...tenant } : null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        if (where.id !== tenant.id) {
          throw new Error("not found");
        }
        return { ...tenant };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(tenant, data);
        return { ...tenant };
      },
    },
    platformOperationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      },
    },
  };

  const prisma = {
    ...client,
    $transaction: async (callback: (tx: typeof client) => Promise<unknown>) =>
      callback(client),
  };

  return { prisma, tenant, events };
}
