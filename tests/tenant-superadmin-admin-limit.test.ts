import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";

import { AuthService } from "../src/modules/auth/auth.service";
import { RolesService } from "../src/modules/roles/roles.service";
import { UsersService } from "../src/modules/users/users.service";

const superadminContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "superadmin-a",
  roleCodes: ["tenant_superadmin"],
  permissions: ["admins.invite", "admins.manage"],
};

function createService(client: Record<string, unknown>) {
  return new UsersService(
    client as never,
    { revokeUserSessions: async () => {} } as never,
    { recordEvent: async () => {} } as never,
  );
}

function withTransaction(client: Record<string, unknown>) {
  return {
    ...client,
    $transaction: async (
      callback: (tx: Record<string, unknown>) => Promise<unknown>,
    ) => callback(client),
  };
}

describe("tenant superadmin admin limit", () => {
  it("blocks inviting a company_admin once the tenant is at its admin limit", async () => {
    const service = createService({
      user: {
        findUnique: async () => null,
        count: async () => 2,
      },
      platformTenant: {
        findUnique: async () => ({ adminLimit: 2 }),
      },
    });

    await assert.rejects(
      () =>
        service.inviteUser(superadminContext as never, {
          email: "admin3@example.com",
          roleCodes: ["company_admin"],
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TENANT_ADMIN_LIMIT",
        );
        return true;
      },
    );
  });

  it("allows inviting a company_admin under the tenant's admin limit", async () => {
    const created: unknown[] = [];
    const service = createService({
      user: {
        findUnique: async () => null,
        count: async () => 1,
      },
      platformTenant: {
        findUnique: async () => ({ adminLimit: 2 }),
      },
      invite: {
        create: async (query: { data: Record<string, unknown> }) => {
          created.push(query);

          return {
            id: "invite-1",
            email: query.data.email,
            roleCodes: query.data.roleCodes,
            status: "pending",
            expiresAt: new Date(Date.now() + 60_000),
          };
        },
      },
    });

    const invite = await service.inviteUser(superadminContext as never, {
      email: "admin3@example.com",
      roleCodes: ["company_admin"],
    });

    assert.equal(invite.email, "admin3@example.com");
    assert.equal(created.length, 1);
  });

  it("blocks granting the company_admin role once the tenant is at its admin limit", async () => {
    const service = createService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "user-b",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [{ roleCode: "team_manager" }],
          }),
          count: async () => 2,
        },
        platformTenant: {
          findUnique: async () => ({ adminLimit: 2 }),
        },
      }),
    );

    await assert.rejects(
      () =>
        service.addRole(superadminContext as never, "user-b", {
          roleCode: "company_admin",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TENANT_ADMIN_LIMIT",
        );
        return true;
      },
    );
  });

  it("blocks reactivating a suspended company_admin past the tenant's admin limit", async () => {
    const service = createService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "user-b",
            tenantId: "tenant-a",
            status: "suspended",
            deletedAt: null,
            roles: [{ roleCode: "company_admin" }],
          }),
          count: async () => 2,
        },
        platformTenant: {
          findUnique: async () => ({ adminLimit: 2 }),
        },
      }),
    );

    await assert.rejects(
      () =>
        service.updateUser(superadminContext as never, "user-b", {
          status: "active",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TENANT_ADMIN_LIMIT",
        );
        return true;
      },
    );
  });

  it("respects a non-default tenant admin limit", async () => {
    const service = createService({
      user: {
        findUnique: async () => null,
        count: async () => 1,
      },
      platformTenant: {
        findUnique: async () => ({ adminLimit: 1 }),
      },
    });

    await assert.rejects(
      () =>
        service.inviteUser(superadminContext as never, {
          email: "admin2@example.com",
          roleCodes: ["company_admin"],
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TENANT_ADMIN_LIMIT",
        );
        assert.match(
          (error.getResponse() as { message: string }).message,
          /limited to 1 active Company Admin/,
        );
        return true;
      },
    );
  });

  it("re-checks the admin limit on invite acceptance, closing the multiple-pending-invite gap", async () => {
    // Two company_admin invites can each pass the invite-time check while the
    // tenant still has zero active admins; if both are accepted, accepting
    // the second one must not push the tenant past its limit.
    const client = {
      invite: {
        findUnique: async () => ({
          id: "invite-2",
          tenantId: "tenant-a",
          email: "admin2@example.com",
          roleCodes: ["company_admin"],
          status: "pending",
          expiresAt: new Date(Date.now() + 60_000),
          createdByUserId: null,
        }),
        update: async () => {},
      },
      platformTenant: {
        findUnique: async () => ({ adminLimit: 1 }),
      },
      user: {
        // The first invite was already accepted, so the tenant already has
        // one active admin — exactly at the limit of 1.
        count: async () => 1,
        upsert: async () => {
          throw new Error("must not create the user once over the limit");
        },
      },
    };
    const authService = new AuthService(
      { ...client, $transaction: async (cb: (tx: unknown) => unknown) => cb(client) } as never,
      { hashPassword: async () => "hashed" } as never,
      new RolesService(),
      {} as never,
      {} as never,
    );

    await assert.rejects(
      () =>
        authService.acceptInvite(
          {
            token: "invite-token",
            name: "Admin Two",
            password: "password123",
          },
          createRequest(),
          {} as never,
        ),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TENANT_ADMIN_LIMIT",
        );
        return true;
      },
    );
  });
});

function createRequest() {
  return {
    requestId: "request-a",
    header: () => undefined,
  };
}
