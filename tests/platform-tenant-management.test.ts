import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

import { PlatformService } from "../src/modules/platform/platform.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";
import type { RequestContext } from "../src/modules/tenancy/request-context";
import type { UsersService } from "../src/modules/users/users.service";

describe("platform tenant management", () => {
  it("updates editable fields and records a tenant.updated event", async () => {
    const store = createStore({
      id: "tenant-1",
      status: "ready",
      name: "Old Name",
      planCode: "pilot",
    });
    const service = createPlatformService(store);

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
    const service = createPlatformService(store);

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
    const service = createPlatformService(store);

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
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.updateTenant("missing", { name: "X" }),
      NotFoundException,
    );
  });

  it("rejects updating an archived tenant", async () => {
    const store = createStore({ id: "tenant-1", status: "archived" });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.updateTenant("tenant-1", { name: "X" }),
      ConflictException,
    );
  });

  it("archives a tenant and records a tenant.archived event", async () => {
    const store = createStore({ id: "tenant-1", status: "active" });
    const service = createPlatformService(store);

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
    const service = createPlatformService(store);

    const result = await service.archiveTenant("tenant-1");

    assert.equal(result.status, "archived");
    assert.equal(store.events.length, 0);
  });

  it("rejects archiving an unknown tenant", async () => {
    const store = createStore({ id: "tenant-1", status: "active" });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.archiveTenant("missing"),
      NotFoundException,
    );
  });

  it("invites a tenant user from the platform context and records an event", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    const service = createPlatformService(store);

    const invite = await service.inviteTenantUser("tenant-1", {
      email: "admin@example.com",
      roleCodes: ["company_admin"],
      actorUserId: "platform-owner-1",
      requestId: "request-1",
    });

    assert.equal(invite.email, "admin@example.com");
    assert.equal(store.inviteCalls.length, 1);
    assert.equal(store.inviteCalls[0]?.context.tenantId, "tenant-1");
    assert.equal(store.inviteCalls[0]?.context.tenantSlug, "pilot-a");
    assert.equal(store.inviteCalls[0]?.context.userId, undefined);
    assert.deepEqual(store.inviteCalls[0]?.body.roleCodes, ["company_admin"]);
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.user_invited");
    assert.equal(store.events[0]?.actorUserId, "platform-owner-1");
    assert.deepEqual(store.events[0]?.metadata, {
      email: "admin@example.com",
      inviteId: "invite-1",
      roleCodes: ["company_admin"],
    });
  });

  it("rejects platform tenant user invites for archived tenants", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () =>
        service.inviteTenantUser("tenant-1", {
          email: "admin@example.com",
          roleCodes: ["company_admin"],
        }),
      ConflictException,
    );

    assert.equal(store.inviteCalls.length, 0);
    assert.equal(store.events.length, 0);
  });

  it("rejects platform tenant user invites for non-admin roles", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () =>
        service.inviteTenantUser("tenant-1", {
          email: "manager@example.com",
          roleCodes: ["team_manager"],
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "PLATFORM_INVITE_ROLE_INVALID",
        );
        return true;
      },
    );

    assert.equal(store.inviteCalls.length, 0);
    assert.equal(store.events.length, 0);
  });

  it("suspends a Company Admin, revokes sessions and records an event", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    store.users.push({
      id: "admin-1",
      tenantId: "tenant-1",
      email: "admin@example.com",
      status: "active",
      roles: [{ roleCode: "company_admin" }],
    });
    const service = createPlatformService(store);

    const updated = await service.updateTenantAdminStatus(
      "tenant-1",
      "admin-1",
      {
        status: "suspended",
        actorUserId: "platform-owner-1",
        requestId: "request-1",
      },
    );

    assert.equal(updated.status, "suspended");
    assert.deepEqual(store.updateUserCalls[0]?.body, { status: "suspended" });
    assert.deepEqual(store.revokedSessions[0], {
      tenantId: "tenant-1",
      userId: "admin-1",
    });
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.admin_suspended");
    assert.deepEqual(store.events[0]?.metadata, {
      userId: "admin-1",
      email: "admin@example.com",
      previousStatus: "active",
      status: "suspended",
    });
  });

  it("reactivates a suspended Company Admin without revoking sessions", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    store.users.push({
      id: "admin-1",
      tenantId: "tenant-1",
      email: "admin@example.com",
      status: "suspended",
      roles: [{ roleCode: "company_admin" }],
    });
    const service = createPlatformService(store);

    const updated = await service.updateTenantAdminStatus(
      "tenant-1",
      "admin-1",
      { status: "active" },
    );

    assert.equal(updated.status, "active");
    assert.equal(store.revokedSessions.length, 0);
    assert.equal(store.events[0]?.eventType, "tenant.admin_reactivated");
  });

  it("rejects platform admin status changes for non-admin users", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    store.users.push({
      id: "manager-1",
      tenantId: "tenant-1",
      email: "manager@example.com",
      status: "active",
      roles: [{ roleCode: "team_manager" }],
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () =>
        service.updateTenantAdminStatus("tenant-1", "manager-1", {
          status: "suspended",
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "PLATFORM_ADMIN_ROLE_REQUIRED",
        );
        return true;
      },
    );

    assert.equal(store.updateUserCalls.length, 0);
    assert.equal(store.revokedSessions.length, 0);
    assert.equal(store.events.length, 0);
  });

  it("propagates the last-admin guard and skips revoke/audit on a rejected suspend", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    store.users.push({
      id: "admin-1",
      tenantId: "tenant-1",
      email: "admin@example.com",
      status: "active",
      roles: [{ roleCode: "company_admin" }],
    });
    // The tenant's sole active Company Admin: UsersService.updateUser rejects
    // with TENANT_LAST_ADMIN, and the platform service must surface that as-is.
    store.updateUserError = new ConflictException({
      code: "TENANT_LAST_ADMIN",
      message: "A tenant must keep at least one active Company Admin.",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () =>
        service.updateTenantAdminStatus("tenant-1", "admin-1", {
          status: "suspended",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TENANT_LAST_ADMIN",
        );
        return true;
      },
    );

    assert.equal(store.revokedSessions.length, 0);
    assert.equal(store.events.length, 0);
  });
});

function createStore(seed: Record<string, unknown> & { id: string }) {
  const tenant: Record<string, unknown> = {
    archivedAt: null,
    slug: "tenant-a",
    ...seed,
  };
  const events: Array<Record<string, unknown>> = [];
  const inviteCalls: Array<{
    context: RequestContext;
    body: Record<string, unknown>;
  }> = [];
  const updateUserCalls: Array<{
    context: RequestContext;
    userId: string;
    body: Record<string, unknown>;
  }> = [];
  const revokedSessions: Array<{ tenantId: string; userId: string }> = [];
  const users: Array<{
    id: string;
    tenantId: string;
    email: string;
    status: string;
    roles: Array<{ roleCode: string }>;
  }> = [];

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
    user: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; tenantId: string; deletedAt: null };
      }) =>
        users.find(
          (user) => user.id === where.id && user.tenantId === where.tenantId,
        ) ?? null,
    },
  };

  const prisma = {
    ...client,
    $transaction: async (callback: (tx: typeof client) => Promise<unknown>) =>
      callback(client),
  };

  return {
    prisma,
    tenant,
    events,
    inviteCalls,
    updateUserCalls,
    revokedSessions,
    users,
    // When set, the UsersService.updateUser stub throws this instead of
    // succeeding, letting tests exercise how the platform service reacts to a
    // rejected update (e.g. the last-admin guard) without booting Nest DI.
    updateUserError: undefined as unknown,
  };
}

function createPlatformService(store: ReturnType<typeof createStore>) {
  const usersService = {
    inviteUser: async (
      context: RequestContext,
      body: Record<string, unknown>,
    ) => {
      store.inviteCalls.push({ context, body });

      return {
        id: "invite-1",
        email: String(body.email),
        roleCodes: body.roleCodes,
        status: "pending",
        expiresAt: new Date("2026-07-13T00:00:00.000Z").toISOString(),
        token: "invite-token",
      };
    },
    listUsers: async () => ({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
      totalPages: 0,
    }),
    updateUser: async (
      context: RequestContext,
      userId: string,
      body: Record<string, unknown>,
    ) => {
      store.updateUserCalls.push({ context, userId, body });

      if (store.updateUserError) {
        throw store.updateUserError;
      }

      const user = store.users.find((item) => item.id === userId);

      if (!user) {
        throw new Error("missing test user");
      }

      user.status = String(body.status);

      return {
        id: user.id,
        email: user.email,
        name: user.email,
        phone: null,
        status: user.status,
        lastSelectedRoleCode: null,
        roleCodes: user.roles.map((role) => role.roleCode),
        createdAt: new Date("2026-07-01T00:00:00.000Z").toISOString(),
        updatedAt: new Date("2026-07-01T00:00:00.000Z").toISOString(),
      };
    },
  } as unknown as UsersService;
  const sessionService = {
    revokeUserSessions: async (tenantId: string, userId: string) => {
      store.revokedSessions.push({ tenantId, userId });
    },
  };

  return new PlatformService(
    store.prisma as unknown as PrismaService,
    usersService,
    sessionService as never,
  );
}
