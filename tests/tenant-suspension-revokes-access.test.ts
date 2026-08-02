import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";

import { SESSION_COOKIE_NAME } from "../src/modules/auth/auth.constants";
import { PermissionGuard } from "../src/modules/auth/permission.guard";
import { PlatformService } from "../src/modules/platform/platform.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";
import { RolesService } from "../src/modules/roles/roles.service";
import type { UsersService } from "../src/modules/users/users.service";

// A tenant's serving status was enforced only where the tenant is resolved by
// slug — login and password reset. Every authenticated request afterwards
// carried a session that had already passed that check, so suspending or
// archiving a tenant stopped nothing that was already signed in until the
// session expired on its own.
describe("tenant suspension revokes access", () => {
  it("refuses an existing session once the tenant stops serving", async () => {
    for (const status of [
      "suspended",
      "archived",
      "draft",
      "provisioning",
      "ready",
      "active",
    ]) {
      const guard = createGuard(status);

      await assert.rejects(
        () => guard.canActivate(createExecutionContext(createRequest("token"))),
        UnauthorizedException,
        `expected a ${status} tenant to reject the session`,
      );
    }
  });

  it("still serves the plan tiers", async () => {
    for (const status of ["pilot", "team", "business"]) {
      const guard = createGuard(status);
      const request = createRequest("token");

      assert.equal(
        await guard.canActivate(createExecutionContext(request)),
        true,
        `expected a ${status} tenant to serve the session`,
      );
      assert.equal(request.context?.tenantId, "tenant-a");
    }
  });

  it("revokes the tenant's open sessions when it is archived", async () => {
    const store = createStore({ id: "tenant-1", status: "pilot" });
    const service = createPlatformService(store);

    await service.archiveTenant("tenant-1", { actorUserId: "owner-1" });

    assert.deepEqual(store.revokedSessions, [
      { tenantId: "tenant-1", revokedAt: null },
    ]);
  });

  it("revokes them when the tenant is suspended, and leaves them alone on a plan change", async () => {
    const suspended = createStore({ id: "tenant-1", status: "pilot" });
    await createPlatformService(suspended).updateTenant("tenant-1", {
      status: "suspended",
    });

    assert.deepEqual(suspended.revokedSessions, [
      { tenantId: "tenant-1", revokedAt: null },
    ]);

    const upgraded = createStore({ id: "tenant-1", status: "pilot" });
    await createPlatformService(upgraded).updateTenant("tenant-1", {
      status: "business",
    });

    assert.deepEqual(upgraded.revokedSessions, []);
  });
});

function createGuard(tenantStatus: string) {
  const session = {
    id: "session-a",
    tenantId: "tenant-a",
    userId: "user-a",
    sessionTokenHash: "hash",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdAt: new Date(),
    lastSeenAt: null,
    userAgentHash: null,
    ipHash: null,
  };
  const prisma = {
    platformTenant: {
      findUnique: async () => ({
        id: "tenant-a",
        slug: "tenant-a",
        status: tenantStatus,
      }),
    },
    user: {
      findFirst: async () => ({
        id: "user-a",
        tenantId: "tenant-a",
        status: "active",
        roles: [{ roleCode: "company_admin" }],
      }),
    },
  };
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === "requiredPermissions" ? [PERMISSIONS.USERS_READ] : undefined,
  };

  return new PermissionGuard(
    prisma as never,
    reflector as never,
    new RolesService(),
    { findActiveSessionByToken: async () => session } as never,
  );
}

function createRequest(token: string) {
  const cookieHeader = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;

  return {
    requestId: "request-a",
    context: undefined as { tenantId: string } | undefined,
    header: (name: string) =>
      name.toLowerCase() === "cookie" ? cookieHeader : undefined,
  };
}

function createExecutionContext(request: ReturnType<typeof createRequest>) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createStore(seed: Record<string, unknown> & { id: string }) {
  const tenant: Record<string, unknown> = {
    name: "Tenant A",
    slug: "tenant-a",
    archivedAt: null,
    adminLimit: 2,
    ...seed,
  };
  const revokedSessions: Array<Record<string, unknown>> = [];

  const client = {
    platformTenant: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === tenant.id ? { ...tenant } : null,
      findUniqueOrThrow: async () => ({ ...tenant }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(tenant, data);
        return { ...tenant };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: string | { not: string } };
        data: Record<string, unknown>;
      }) => {
        const statusMatches =
          where.status === undefined
            ? true
            : typeof where.status === "string"
              ? tenant.status === where.status
              : tenant.status !== where.status.not;

        if (where.id !== tenant.id || !statusMatches) {
          return { count: 0 };
        }

        Object.assign(tenant, data);
        return { count: 1 };
      },
    },
    platformOperationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => data,
    },
    session: {
      updateMany: async ({ where }: { where: Record<string, unknown> }) => {
        revokedSessions.push(where);
        return { count: revokedSessions.length };
      },
    },
  };

  const prisma = {
    ...client,
    $transaction: async (callback: (tx: typeof client) => Promise<unknown>) =>
      callback(client),
  };

  return { prisma, tenant, revokedSessions };
}

function createPlatformService(store: ReturnType<typeof createStore>) {
  return new PlatformService(
    store.prisma as unknown as PrismaService,
    {} as UsersService,
    {} as never,
  );
}
