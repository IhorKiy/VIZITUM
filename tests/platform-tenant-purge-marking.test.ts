import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

import { PlatformService } from "../src/modules/platform/platform.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";
import type { UsersService } from "../src/modules/users/users.service";

describe("platform tenant purge marking", () => {
  it("marks an archived tenant for purge and records a tenant.purge_requested event", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      name: "Pilot A",
      status: "archived",
      archivedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    const service = createPlatformService(store);

    const marked = await service.requestTenantPurge("tenant-1", {
      confirmSlug: "pilot-a",
      actorUserId: "owner-1",
      mfaCode: "123456",
    });

    assert.ok(marked.purgeRequestedAt instanceof Date);
    assert.equal(marked.status, "archived");
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.purge_requested");
    assert.equal(store.events[0]?.actorUserId, "owner-1");
    assert.deepEqual(store.events[0]?.metadata, {
      slug: "pilot-a",
      name: "Pilot A",
    });
  });

  it("rejects a mistyped confirmation slug and changes nothing", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.requestTenantPurge("tenant-1", { confirmSlug: "pilot-b" }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "TENANT_PURGE_CONFIRMATION_MISMATCH");
        assert.ok(response.fieldErrors.confirmSlug);
        return true;
      },
    );
    assert.equal(store.tenant.purgeRequestedAt, null);
    assert.equal(store.events.length, 0);
  });

  it("rejects a missing or non-string confirmation slug", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
    });
    const service = createPlatformService(store);

    for (const confirmSlug of [undefined, "", 42, { slug: "pilot-a" }]) {
      await assert.rejects(
        () => service.requestTenantPurge("tenant-1", { confirmSlug }),
        BadRequestException,
      );
    }
    assert.equal(store.tenant.purgeRequestedAt, null);
    assert.equal(store.events.length, 0);
  });

  it("accepts the slug with surrounding whitespace and different casing, like tenant creation does", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
    });
    const service = createPlatformService(store);

    const marked = await service.requestTenantPurge("tenant-1", {
      confirmSlug: "  Pilot-A  ",
      actorUserId: "owner-1",
      mfaCode: "123456",
    });

    assert.ok(marked.purgeRequestedAt instanceof Date);
  });

  it("refuses to mark a non-archived tenant even with the right slug", async () => {
    for (const status of ["pilot", "team", "business", "suspended"]) {
      const store = createStore({
        id: "tenant-1",
        slug: "pilot-a",
        status,
      });
      const service = createPlatformService(store);

      await assert.rejects(
        () =>
          service.requestTenantPurge("tenant-1", { confirmSlug: "pilot-a" }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          assert.equal(
            (error.getResponse() as { code: string }).code,
            "TENANT_NOT_ARCHIVED",
          );
          return true;
        },
      );
      assert.equal(store.tenant.purgeRequestedAt, null);
      assert.equal(store.events.length, 0);
    }
  });

  it("rejects marking an unknown tenant", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.requestTenantPurge("missing", { confirmSlug: "pilot-a" }),
      NotFoundException,
    );
  });

  it("is idempotent when the tenant is already marked for purge", async () => {
    const requestedAt = new Date("2026-07-01T00:00:00.000Z");
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
      purgeRequestedAt: requestedAt,
    });
    const service = createPlatformService(store);

    const result = await service.requestTenantPurge("tenant-1", {
      confirmSlug: "pilot-a",
    });

    assert.equal(result.purgeRequestedAt, requestedAt);
    assert.equal(store.events.length, 0);
  });

  it("is idempotent when the purge worker has already started", async () => {
    const startedAt = new Date("2026-07-02T00:00:00.000Z");
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
      purgeStartedAt: startedAt,
    });
    const service = createPlatformService(store);

    const result = await service.requestTenantPurge("tenant-1", {
      confirmSlug: "pilot-a",
    });

    assert.equal(result.purgeRequestedAt, null);
    assert.equal(result.purgeStartedAt, startedAt);
    assert.equal(store.events.length, 0);
  });

  it("closes the marking race: does not duplicate the event when a concurrent request already marked the tenant", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
    });
    // The outer check reads an unmarked tenant, but by the time the
    // transaction's conditional update runs, another request has already
    // stamped purgeRequestedAt.
    store.raceState.mutation = {
      purgeRequestedAt: new Date("2026-07-03T00:00:00.000Z"),
    };
    const service = createPlatformService(store);

    const result = await service.requestTenantPurge("tenant-1", {
      confirmSlug: "pilot-a",
      actorUserId: "owner-1",
      mfaCode: "123456",
    });

    assert.ok(result.purgeRequestedAt instanceof Date);
    assert.equal(store.events.length, 0);
  });

  it("closes the unarchive race: marking loses against a concurrent unarchive without emitting an event", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
    });
    store.raceState.mutation = { status: "suspended", archivedAt: null };
    const service = createPlatformService(store);

    const result = await service.requestTenantPurge("tenant-1", {
      confirmSlug: "pilot-a",
      actorUserId: "owner-1",
      mfaCode: "123456",
    });

    assert.equal(result.status, "suspended");
    assert.equal(result.purgeRequestedAt, null);
    assert.equal(store.events.length, 0);
  });

  it("unarchive clears a pending purge request so a rescued tenant is never purged", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
      archivedAt: new Date("2026-06-01T00:00:00.000Z"),
      purgeRequestedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const service = createPlatformService(store);

    const restored = await service.unarchiveTenant("tenant-1", {
      actorUserId: "owner-1",
    });

    assert.equal(restored.status, "suspended");
    assert.equal(restored.purgeRequestedAt, null);
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.unarchived");
  });

  it("unarchive refuses a tenant whose purge has started", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
      purgeStartedAt: new Date("2026-07-02T00:00:00.000Z"),
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.unarchiveTenant("tenant-1"),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TENANT_PURGE_IN_PROGRESS",
        );
        return true;
      },
    );
    assert.equal(store.tenant.status, "archived");
    assert.equal(store.events.length, 0);
  });

  it("closes the claim race: unarchive loses against the purge worker claiming the tenant mid-request", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
    });
    // The outer check reads an unclaimed archived tenant, but the purge
    // worker stamps purgeStartedAt before the conditional update runs.
    store.raceState.mutation = {
      purgeStartedAt: new Date("2026-07-02T00:00:00.000Z"),
    };
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.unarchiveTenant("tenant-1"),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TENANT_PURGE_IN_PROGRESS",
        );
        return true;
      },
    );
    assert.equal(store.tenant.status, "archived");
    assert.equal(store.events.length, 0);
  });
});

type TenantWhere = {
  id: string;
  status?: string | { not: string };
  purgeRequestedAt?: null;
  purgeStartedAt?: null;
};

function createStore(seed: Record<string, unknown> & { id: string }) {
  const tenant: Record<string, unknown> = {
    name: "Tenant A",
    slug: "tenant-a",
    archivedAt: null,
    purgeRequestedAt: null,
    purgeStartedAt: null,
    adminLimit: 2,
    ...seed,
  };
  const events: Array<Record<string, unknown>> = [];
  // When `mutation` is set, the next updateMany applies it to the tenant
  // before evaluating its where clause, simulating a concurrent writer that
  // changed the row between the outer idempotency check and the
  // transactional conditional update.
  const raceState: { mutation?: Record<string, unknown> } = {};

  const matchesWhere = (where: TenantWhere): boolean => {
    if (where.id !== tenant.id) {
      return false;
    }

    if (where.status !== undefined) {
      const matches =
        typeof where.status === "string"
          ? tenant.status === where.status
          : tenant.status !== where.status.not;

      if (!matches) {
        return false;
      }
    }

    if (where.purgeRequestedAt === null && tenant.purgeRequestedAt !== null) {
      return false;
    }

    if (where.purgeStartedAt === null && tenant.purgeStartedAt !== null) {
      return false;
    }

    return true;
  };

  const client = {
    platformUser: {
      findUnique: async () => ({
        id: "owner-1",
        totpSecret: "SECRET",
        status: "active",
      }),
    },
    platformTenant: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === tenant.id ? { ...tenant } : null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        if (where.id !== tenant.id) {
          throw new Error("not found");
        }
        return { ...tenant };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: TenantWhere;
        data: Record<string, unknown>;
      }) => {
        if (raceState.mutation) {
          Object.assign(tenant, raceState.mutation);
          raceState.mutation = undefined;
        }

        if (!matchesWhere(where)) {
          return { count: 0 };
        }

        Object.assign(tenant, data);
        return { count: 1 };
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

  return { prisma, tenant, events, raceState };
}

function createPlatformService(
  store: ReturnType<typeof createStore>,
  options: { codeAccepted?: boolean } = {},
) {
  return new PlatformService(
    store.prisma as unknown as PrismaService,
    {} as UsersService,
    {} as never,
    {
      acceptTotpCode: async () => options.codeAccepted ?? true,
    } as never,
  );
}
