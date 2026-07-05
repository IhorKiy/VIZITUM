import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";

import { AuthService } from "../src/modules/auth/auth.service";
import { SESSION_COOKIE_NAME } from "../src/modules/auth/auth.constants";
import { PermissionGuard } from "../src/modules/auth/permission.guard";
import { PERMISSIONS } from "../src/modules/roles/permissions";
import { RolesService } from "../src/modules/roles/roles.service";

describe("auth tenant isolation", () => {
  it("loads the current user only from the session tenant", async () => {
    const session = createSession();
    const rolesService = new RolesService();
    const userQueries: unknown[] = [];
    const prisma = {
      user: {
        findFirst: async (query: unknown) => {
          userQueries.push(query);
          return null;
        },
      },
      tenantSetting: {
        findUnique: async () => null,
      },
    };
    const authService = new AuthService(
      prisma as never,
      {} as never,
      rolesService,
      createSessionService(session) as never,
      {} as never,
    );

    await assert.rejects(
      () => authService.getCurrentUser(createRequest("session-token")),
      UnauthorizedException,
    );
    assert.deepEqual(userQueries, [
      {
        where: {
          id: session.userId,
          tenantId: session.tenantId,
        },
        include: { roles: true },
      },
    ]);
  });

  it("checks role switching against the session tenant user record", async () => {
    const session = createSession();
    const userQueries: unknown[] = [];
    const prisma = {
      user: {
        findFirst: async (query: unknown) => {
          userQueries.push(query);
          return null;
        },
      },
    };
    const authService = new AuthService(
      prisma as never,
      {} as never,
      new RolesService(),
      createSessionService(session) as never,
      {} as never,
    );

    await assert.rejects(
      () =>
        authService.switchRole(
          { roleCode: "company_admin" },
          createRequest("session-token"),
        ),
      UnauthorizedException,
    );
    assert.deepEqual(userQueries, [
      {
        where: {
          id: session.userId,
          tenantId: session.tenantId,
        },
        include: { roles: true },
      },
    ]);
  });

  it("rejects permission checks when the session user is not in the session tenant", async () => {
    const session = createSession();
    const userQueries: unknown[] = [];
    const prisma = {
      platformTenant: {
        findUnique: async () => ({
          id: session.tenantId,
          slug: "tenant-a",
        }),
      },
      user: {
        findFirst: async (query: unknown) => {
          userQueries.push(query);
          return null;
        },
      },
    };
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === "requiredPermissions" ? [PERMISSIONS.USERS_READ] : undefined,
    };
    const guard = new PermissionGuard(
      prisma as never,
      reflector as never,
      new RolesService(),
      createSessionService(session) as never,
    );

    await assert.rejects(
      () => guard.canActivate(createExecutionContext(createRequest("token"))),
      UnauthorizedException,
    );
    assert.deepEqual(userQueries, [
      {
        where: {
          id: session.userId,
          tenantId: session.tenantId,
        },
        include: { roles: true },
      },
    ]);
  });

  it("allows platform operations bearer token for operations summary checks", async () => {
    const restoreEnv = setPlatformOperationsToken("operator-token");

    try {
      let sessionLookupCount = 0;
      const reflector = {
        getAllAndOverride: (key: string) =>
          key === "requiredPermissions"
            ? [PERMISSIONS.PLATFORM_OPERATIONS_READ]
            : undefined,
      };
      const guard = new PermissionGuard(
        {} as never,
        reflector as never,
        new RolesService(),
        {
          findActiveSessionByToken: async () => {
            sessionLookupCount += 1;
            return null;
          },
        } as never,
      );
      const request = createRequest(undefined, "Bearer operator-token");

      await assert.equal(
        await guard.canActivate(createExecutionContext(request)),
        true,
      );
      assert.equal(sessionLookupCount, 0);
      assert.deepEqual(request.context, {
        requestId: "request-a",
        tenantId: "platform",
        tenantSlug: "platform",
        roleCodes: [],
        permissions: [PERMISSIONS.PLATFORM_OPERATIONS_READ],
      });
    } finally {
      restoreEnv();
    }
  });

  it("rejects the platform operations bearer token for tenant management", async () => {
    const restoreEnv = setPlatformOperationsToken("operator-token");

    try {
      const reflector = {
        getAllAndOverride: (key: string) =>
          key === "requiredPermissions"
            ? [PERMISSIONS.PLATFORM_TENANTS_MANAGE]
            : undefined,
      };
      const guard = new PermissionGuard(
        {} as never,
        reflector as never,
        new RolesService(),
        {
          findActiveSessionByToken: async () => {
            throw new Error("session lookup must not run for a bearer token");
          },
        } as never,
      );
      const request = createRequest(undefined, "Bearer operator-token");

      // The operations bearer token is a read-only service credential: it must
      // never satisfy platform.tenants.manage. If someone re-broadens
      // buildPlatformOperationsContext, this pins the regression.
      await assert.rejects(
        () => guard.canActivate(createExecutionContext(request)),
        (error: unknown) => {
          assert.ok(error instanceof ForbiddenException);
          assert.equal(
            (error.getResponse() as { code: string }).code,
            "MISSING_PERMISSION",
          );
          return true;
        },
      );
    } finally {
      restoreEnv();
    }
  });

  it("resolves login tenant from an explicit tenant slug body", async () => {
    const tenantResolutionInputs: unknown[] = [];
    const authService = new AuthService(
      {
        user: {
          findUnique: async () => null,
        },
      } as never,
      { verifyPassword: async () => false } as never,
      new RolesService(),
      createSessionService(createSession()) as never,
      {
        resolveTenant: async (input: unknown) => {
          tenantResolutionInputs.push(input);
          return {
            tenant: { id: "tenant-a" },
            slug: "tenant-a",
          };
        },
      } as never,
    );

    await assert.rejects(
      () =>
        authService.login(
          {
            email: "USER@EXAMPLE.COM",
            password: "secret",
            tenantSlug: "Tenant-A",
          },
          {
            header: (name: string) =>
              name.toLowerCase() === "host" ? "localhost:4000" : undefined,
            path: "/api/auth/login",
          } as never,
          {} as never,
        ),
      UnauthorizedException,
    );
    assert.deepEqual(tenantResolutionInputs, [
      {
        host: "localhost:4000",
        path: "tenant-a",
      },
    ]);
  });

  it("rejects invite acceptance when the page tenant does not match the invite tenant", async () => {
    let capturedTenantLookup: unknown;
    const authService = new AuthService(
      {
        invite: {
          findUnique: async () => ({
            id: "invite-a",
            tenantId: "tenant-a",
            email: "new-user@example.com",
            roleCodes: ["field_representative"],
            status: "pending",
            expiresAt: new Date(Date.now() + 60_000),
            createdByUserId: "admin-a",
          }),
        },
        platformTenant: {
          findUnique: async (query: unknown) => {
            capturedTenantLookup = query;

            return { id: "tenant-b" };
          },
        },
      } as never,
      {} as never,
      new RolesService(),
      createSessionService(createSession()) as never,
      {} as never,
    );

    await assert.rejects(
      () =>
        authService.acceptInvite(
          {
            token: "invite-token",
            tenantSlug: "tenant-b",
            name: "New User",
            password: "password123",
          },
          createRequest(),
          {} as never,
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "INVITE_INVALID",
        );
        return true;
      },
    );
    assert.deepEqual(capturedTenantLookup, {
      where: { slug: "tenant-b" },
      select: { id: true },
    });
  });
});

// Sets PLATFORM_OPERATIONS_TOKEN for the plaintext comparison path and clears
// PLATFORM_OPERATIONS_TOKEN_SHA256, since the guard prefers the hash var when
// present — leaving it set (e.g. from an ambient .env) would make the guard
// ignore the plaintext token this helper sets and break the test.
function setPlatformOperationsToken(token: string): () => void {
  const previousToken = process.env.PLATFORM_OPERATIONS_TOKEN;
  const previousHash = process.env.PLATFORM_OPERATIONS_TOKEN_SHA256;

  process.env.PLATFORM_OPERATIONS_TOKEN = token;
  delete process.env.PLATFORM_OPERATIONS_TOKEN_SHA256;

  return () => {
    if (previousToken === undefined) {
      delete process.env.PLATFORM_OPERATIONS_TOKEN;
    } else {
      process.env.PLATFORM_OPERATIONS_TOKEN = previousToken;
    }

    if (previousHash === undefined) {
      delete process.env.PLATFORM_OPERATIONS_TOKEN_SHA256;
    } else {
      process.env.PLATFORM_OPERATIONS_TOKEN_SHA256 = previousHash;
    }
  };
}

function createSession() {
  return {
    id: "session-a",
    tenantId: "tenant-a",
    userId: "user-from-other-tenant",
    sessionTokenHash: "hash",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdAt: new Date(),
    lastSeenAt: null,
    userAgentHash: null,
    ipHash: null,
  };
}

function createSessionService(session: ReturnType<typeof createSession>) {
  return {
    findActiveSessionByToken: async () => session,
  };
}

function createRequest(token?: string, authorization?: string) {
  return {
    requestId: "request-a",
    header: (name: string) => {
      const headerName = name.toLowerCase();

      if (headerName === "authorization") {
        return authorization;
      }

      if (headerName === "cookie" && token) {
        return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
      }

      return undefined;
    },
  };
}

function createExecutionContext(request: ReturnType<typeof createRequest>) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}
