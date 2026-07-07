import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { AuthService } from "../src/modules/auth/auth.service";
import { RolesService } from "../src/modules/roles/roles.service";
import { UsersService } from "../src/modules/users/users.service";

function createRequest() {
  return {
    requestId: "request-a",
    header: () => undefined,
  };
}

function createResponse() {
  return { cookie: () => {} };
}

describe("tenant superadmin replacement", () => {
  it("demotes the previously active superadmin to a suspended company_admin when a new superadmin invite is accepted", async () => {
    const userUpdates: unknown[] = [];
    const roleDeletes: unknown[] = [];
    const roleUpserts: unknown[] = [];
    const auditEvents: unknown[] = [];
    const client = {
      invite: {
        findUnique: async () => ({
          id: "invite-new",
          tenantId: "tenant-a",
          email: "super2@example.com",
          roleCodes: ["tenant_superadmin"],
          status: "pending",
          expiresAt: new Date(Date.now() + 60_000),
          createdByUserId: null,
        }),
        update: async () => {},
      },
      user: {
        upsert: async () => ({
          id: "super2-user",
          email: "super2@example.com",
          name: "Super Two",
          status: "active",
          lastSelectedRoleCode: "tenant_superadmin",
        }),
        findMany: async (query: {
          where: { id: { not: string }; roles: { some: { roleCode: string } } };
        }) => {
          assert.equal(query.where.id.not, "super2-user");
          assert.equal(query.where.roles.some.roleCode, "tenant_superadmin");

          return [{ id: "super1-user" }];
        },
        update: async (query: { where: { id: string }; data: unknown }) => {
          userUpdates.push(query);
          return {};
        },
      },
      userRole: {
        deleteMany: async (query: unknown) => {
          roleDeletes.push(query);
        },
        upsert: async (query: unknown) => {
          roleUpserts.push(query);
          return {};
        },
      },
      auditEvent: {
        create: async (query: { data: Record<string, unknown> }) => {
          auditEvents.push(query.data);
        },
      },
    };
    const authService = new AuthService(
      {
        ...client,
        $transaction: async (cb: (tx: unknown) => unknown) => cb(client),
      } as never,
      { hashPassword: async () => "hashed" } as never,
      new RolesService(),
      { createSession: async () => ({ token: "session-token" }) } as never,
      {} as never,
    );

    const result = await authService.acceptInvite(
      {
        token: "invite-token",
        name: "Super Two",
        password: "password123",
      },
      createRequest() as never,
      createResponse() as never,
    );

    assert.equal(result.roleCodes[0], "tenant_superadmin");
    assert.equal(userUpdates.length, 1);
    assert.deepEqual(userUpdates[0], {
      where: { id: "super1-user" },
      data: { status: "suspended", lastSelectedRoleCode: "company_admin" },
    });

    // The previous superadmin's role is swapped to company_admin, not just
    // deactivated — otherwise assertTargetNotSuperadmin would make that
    // account permanently unreachable by anyone.
    const demotedRoleDelete = roleDeletes.find(
      (query) =>
        (query as { where: { userId: string } }).where.userId ===
        "super1-user",
    );
    assert.deepEqual(demotedRoleDelete, {
      where: {
        tenantId: "tenant-a",
        userId: "super1-user",
        roleCode: "tenant_superadmin",
      },
    });

    const demotedRoleUpsert = roleUpserts.find(
      (query) =>
        (query as { create: { userId: string } }).create.userId ===
        "super1-user",
    );
    assert.equal(
      (demotedRoleUpsert as { create: { roleCode: string } }).create.roleCode,
      "company_admin",
    );

    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0]?.eventType, "superadmin.replaced");
    assert.equal(auditEvents[0]?.entityId, "super1-user");
    assert.deepEqual(auditEvents[0]?.metadata, {
      newSuperadminUserId: "super2-user",
    });
  });

  it("does not touch any other user when accepting the tenant's first superadmin invite", async () => {
    const userUpdates: unknown[] = [];
    const client = {
      invite: {
        findUnique: async () => ({
          id: "invite-first",
          tenantId: "tenant-a",
          email: "super1@example.com",
          roleCodes: ["tenant_superadmin"],
          status: "pending",
          expiresAt: new Date(Date.now() + 60_000),
          createdByUserId: null,
        }),
        update: async () => {},
      },
      user: {
        upsert: async () => ({
          id: "super1-user",
          email: "super1@example.com",
          name: "Super One",
          status: "active",
          lastSelectedRoleCode: "tenant_superadmin",
        }),
        findMany: async () => [],
        update: async (query: unknown) => {
          userUpdates.push(query);
          return {};
        },
      },
      userRole: { upsert: async () => ({}) },
    };
    const authService = new AuthService(
      {
        ...client,
        $transaction: async (cb: (tx: unknown) => unknown) => cb(client),
      } as never,
      { hashPassword: async () => "hashed" } as never,
      new RolesService(),
      { createSession: async () => ({ token: "session-token" }) } as never,
      {} as never,
    );

    await authService.acceptInvite(
      { token: "invite-token", name: "Super One", password: "password123" },
      createRequest() as never,
      createResponse() as never,
    );

    assert.equal(userUpdates.length, 0);
  });

  it("promotes an active company_admin, swapping their role for tenant_superadmin", async () => {
    let roleDeleteQuery: unknown;
    let roleUpsertQuery: unknown;
    let finalUserUpdate: unknown;
    const client = {
      user: {
        findFirst: async () => ({
          id: "admin-a",
          tenantId: "tenant-a",
          status: "active",
          deletedAt: null,
          roles: [{ roleCode: "company_admin" }],
        }),
        findMany: async () => [],
        update: async (query: { data: unknown }) => {
          finalUserUpdate = query.data;

          return {
            id: "admin-a",
            email: "admin-a@example.com",
            name: "Admin A",
            phone: null,
            status: "active",
            lastSelectedRoleCode: "tenant_superadmin",
            roles: [{ roleCode: "tenant_superadmin" }],
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
            updatedAt: new Date("2026-07-01T00:00:00.000Z"),
          };
        },
      },
      userRole: {
        deleteMany: async (query: unknown) => {
          roleDeleteQuery = query;
        },
        upsert: async (query: unknown) => {
          roleUpsertQuery = query;
          return {};
        },
      },
    };

    const usersService = new UsersService(
      {
        ...client,
        $transaction: async (cb: (tx: unknown) => unknown) => cb(client),
      } as never,
      { revokeUserSessions: async () => {} } as never,
      { recordEvent: async () => {} } as never,
    );

    const context = {
      requestId: "request-a",
      tenantId: "tenant-a",
      tenantSlug: "tenant-a",
      userId: undefined,
      roleCodes: [],
      permissions: [],
    };

    const promoted = await usersService.promoteToSuperadmin(
      context as never,
      "admin-a",
    );

    assert.equal(promoted.roleCodes[0], "tenant_superadmin");
    assert.deepEqual(roleDeleteQuery, {
      where: {
        tenantId: "tenant-a",
        userId: "admin-a",
        roleCode: "company_admin",
      },
    });
    assert.equal(
      (roleUpsertQuery as { create: { roleCode: string } }).create.roleCode,
      "tenant_superadmin",
    );
    assert.equal(
      (finalUserUpdate as { lastSelectedRoleCode: string }).lastSelectedRoleCode,
      "tenant_superadmin",
    );
  });

  it("demotes any other active superadmin when promoting a company_admin in place", async () => {
    const demoteUpdates: unknown[] = [];
    const roleDeletes: unknown[] = [];
    const roleUpserts: unknown[] = [];
    const client = {
      user: {
        findFirst: async () => ({
          id: "admin-a",
          tenantId: "tenant-a",
          status: "active",
          deletedAt: null,
          roles: [{ roleCode: "company_admin" }],
        }),
        findMany: async () => [{ id: "old-super" }],
        update: async (query: { where: { id: string }; data: unknown }) => {
          if (query.where.id === "old-super") {
            demoteUpdates.push(query);
            return {};
          }

          return {
            id: "admin-a",
            email: "admin-a@example.com",
            name: "Admin A",
            phone: null,
            status: "active",
            lastSelectedRoleCode: "tenant_superadmin",
            roles: [{ roleCode: "tenant_superadmin" }],
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
            updatedAt: new Date("2026-07-01T00:00:00.000Z"),
          };
        },
      },
      userRole: {
        deleteMany: async (query: unknown) => {
          roleDeletes.push(query);
        },
        upsert: async (query: unknown) => {
          roleUpserts.push(query);
          return {};
        },
      },
    };
    const usersService = new UsersService(
      {
        ...client,
        $transaction: async (cb: (tx: unknown) => unknown) => cb(client),
      } as never,
      { revokeUserSessions: async () => {} } as never,
      { recordEvent: async () => {} } as never,
    );

    await usersService.promoteToSuperadmin(
      {
        requestId: "request-a",
        tenantId: "tenant-a",
        tenantSlug: "tenant-a",
        userId: undefined,
        roleCodes: [],
        permissions: [],
      } as never,
      "admin-a",
    );

    assert.equal(demoteUpdates.length, 1);
    assert.deepEqual(demoteUpdates[0], {
      where: { id: "old-super" },
      data: { status: "suspended", lastSelectedRoleCode: "company_admin" },
    });

    const demotedRoleDelete = roleDeletes.find(
      (query) =>
        (query as { where: { userId: string } }).where.userId ===
        "old-super",
    );
    assert.deepEqual(demotedRoleDelete, {
      where: {
        tenantId: "tenant-a",
        userId: "old-super",
        roleCode: "tenant_superadmin",
      },
    });

    const demotedRoleUpsert = roleUpserts.find(
      (query) =>
        (query as { create: { userId: string } }).create.userId ===
        "old-super",
    );
    assert.equal(
      (demotedRoleUpsert as { create: { roleCode: string } }).create.roleCode,
      "company_admin",
    );
  });

  it("rejects promoting a user who isn't an active company_admin", async () => {
    const client = {
      user: {
        findFirst: async () => ({
          id: "manager-a",
          tenantId: "tenant-a",
          status: "active",
          deletedAt: null,
          roles: [{ roleCode: "team_manager" }],
        }),
      },
    };
    const usersService = new UsersService(
      {
        ...client,
        $transaction: async (cb: (tx: unknown) => unknown) => cb(client),
      } as never,
      { revokeUserSessions: async () => {} } as never,
      { recordEvent: async () => {} } as never,
    );

    await assert.rejects(
      () =>
        usersService.promoteToSuperadmin(
          {
            requestId: "request-a",
            tenantId: "tenant-a",
            tenantSlug: "tenant-a",
            userId: undefined,
            roleCodes: [],
            permissions: [],
          } as never,
          "manager-a",
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "ADMIN_ROLE_REQUIRED",
        );
        return true;
      },
    );
  });
});
