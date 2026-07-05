import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UsersService } from "../src/modules/users/users.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "user-a",
  roleCodes: ["company_admin"],
  permissions: [],
};

describe("users service", () => {
  it("lists recent tenant invites with resolved expiry status", async () => {
    const service = new UsersService({
      invite: {
        findMany: async (query: unknown) => {
          assert.deepEqual(query, {
            where: {
              tenantId: "tenant-a",
            },
            include: {
              createdBy: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                },
              },
              acceptedBy: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                },
              },
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 10,
          });

          return [
            {
              id: "invite-pending",
              email: "new@example.com",
              roleCodes: ["field_representative"],
              status: "pending",
              expiresAt: new Date(Date.now() + 60_000),
              acceptedAt: null,
              createdAt: new Date("2026-07-03T10:00:00.000Z"),
              createdBy: {
                id: "user-a",
                email: "admin@example.com",
                name: "Admin User",
              },
              acceptedBy: null,
            },
            {
              id: "invite-expired",
              email: "old@example.com",
              roleCodes: ["team_manager"],
              status: "pending",
              expiresAt: new Date("2026-07-01T10:00:00.000Z"),
              acceptedAt: null,
              createdAt: new Date("2026-06-24T10:00:00.000Z"),
              createdBy: null,
              acceptedBy: null,
            },
          ];
        },
      },
    } as never);

    const invites = await service.listInvites(context as never);

    assert.equal(invites.length, 2);
    assert.equal(invites[0].status, "pending");
    assert.equal(invites[0].createdBy?.name, "Admin User");
    assert.equal(invites[1].status, "expired");
  });

  it("resends a pending invite by revoking the old invite and creating a fresh token", async () => {
    const updates: unknown[] = [];
    const creates: unknown[] = [];
    const service = new UsersService({
      invite: {
        findFirst: async (query: unknown) => {
          assert.deepEqual(query, {
            where: {
              id: "invite-a",
              tenantId: "tenant-a",
            },
            select: {
              id: true,
              email: true,
              roleCodes: true,
              status: true,
              expiresAt: true,
            },
          });

          return {
            id: "invite-a",
            email: "new@example.com",
            roleCodes: ["field_representative"],
            status: "pending",
            expiresAt: new Date(Date.now() + 60_000),
          };
        },
        update: async (query: unknown) => {
          updates.push(query);
        },
        create: async (query: {
          data: {
            tenantId: string;
            email: string;
            roleCodes: string[];
            tokenHash: string;
            expiresAt: Date;
            createdByUserId: string;
          };
        }) => {
          creates.push(query);

          return {
            id: "invite-b",
            email: query.data.email,
            roleCodes: query.data.roleCodes,
            status: "pending",
            expiresAt: query.data.expiresAt,
          };
        },
      },
    } as never);

    const resentInvite = await service.resendInvite(
      context as never,
      "invite-a",
    );

    assert.deepEqual(updates, [
      {
        where: { id: "invite-a" },
        data: { status: "revoked" },
      },
    ]);
    assert.equal(creates.length, 1);
    assert.equal(resentInvite.id, "invite-b");
    assert.equal(resentInvite.email, "new@example.com");
    assert.equal(resentInvite.roleCodes[0], "field_representative");
    assert.ok(resentInvite.token.length > 20);
  });

  function withTransaction(client: Record<string, unknown>) {
    return {
      ...client,
      $transaction: async (
        callback: (tx: Record<string, unknown>) => Promise<unknown>,
      ) => callback(client),
    };
  }

  it("blocks removing the tenant's last active company_admin role", async () => {
    let capturedCountWhere: unknown;
    const service = new UsersService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "user-a",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [
              { roleCode: "company_admin" },
              { roleCode: "team_manager" },
            ],
          }),
          count: async (query: { where: unknown }) => {
            capturedCountWhere = query.where;

            return 0;
          },
        },
      }) as never,
    );

    await assert.rejects(
      () => service.removeRole(context as never, "user-a", "company_admin"),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "TENANT_LAST_ADMIN",
    );
    assert.deepEqual(capturedCountWhere, {
      tenantId: "tenant-a",
      id: { not: "user-a" },
      status: "active",
      deletedAt: null,
      roles: { some: { tenantId: "tenant-a", roleCode: "company_admin" } },
    });
  });

  it("allows removing company_admin when another active admin remains", async () => {
    const deletedRoles: unknown[] = [];
    const service = new UsersService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "user-a",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [
              { roleCode: "company_admin" },
              { roleCode: "team_manager" },
            ],
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
            updatedAt: new Date("2026-07-04T00:00:00.000Z"),
          }),
          count: async () => 1,
        },
        userRole: {
          deleteMany: async (query: unknown) => {
            deletedRoles.push(query);
          },
        },
      }) as never,
    );

    await service.removeRole(context as never, "user-a", "company_admin");

    assert.equal(deletedRoles.length, 1);
  });

  it("blocks removing a user's only remaining role", async () => {
    const service = new UsersService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "user-a",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [{ roleCode: "field_representative" }],
          }),
        },
      }) as never,
    );

    await assert.rejects(
      () =>
        service.removeRole(context as never, "user-a", "field_representative"),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "USER_LAST_ROLE",
    );
  });

  it("blocks suspending the tenant's last active company_admin", async () => {
    const service = new UsersService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "user-a",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [{ roleCode: "company_admin" }],
          }),
          count: async () => 0,
        },
      }) as never,
    );

    await assert.rejects(
      () =>
        service.updateUser(context as never, "user-a", {
          status: "suspended",
        }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "TENANT_LAST_ADMIN",
    );
  });

  it("allows suspending a company_admin when another active admin remains", async () => {
    const service = new UsersService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "user-a",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [{ roleCode: "company_admin" }],
          }),
          count: async () => 1,
          update: async () => ({
            id: "user-a",
            email: "admin@example.com",
            name: "Admin",
            phone: null,
            status: "suspended",
            lastSelectedRoleCode: null,
            roles: [{ roleCode: "company_admin" }],
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
            updatedAt: new Date("2026-07-04T00:00:00.000Z"),
          }),
        },
      }) as never,
    );

    const updated = await service.updateUser(context as never, "user-a", {
      status: "suspended",
    });

    assert.equal(updated.status, "suspended");
  });

  it("runs the last-admin lockout check under a serializable transaction to close the check-then-act race", async () => {
    const transactionCalls: unknown[] = [];
    const client = {
      user: {
        findFirst: async () => ({
          id: "user-a",
          tenantId: "tenant-a",
          status: "active",
          deletedAt: null,
          roles: [{ roleCode: "company_admin" }],
        }),
        count: async () => 1,
        update: async () => ({
          id: "user-a",
          email: "admin@example.com",
          name: "Admin",
          phone: null,
          status: "suspended",
          lastSelectedRoleCode: null,
          roles: [{ roleCode: "company_admin" }],
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: new Date("2026-07-04T00:00:00.000Z"),
        }),
      },
      $transaction: async (
        callback: (tx: unknown) => Promise<unknown>,
        options: unknown,
      ) => {
        transactionCalls.push(options);

        return callback(client);
      },
    };
    const service = new UsersService(client as never);

    await service.updateUser(context as never, "user-a", {
      status: "suspended",
    });

    assert.deepEqual(transactionCalls, [{ isolationLevel: "Serializable" }]);
  });
});
