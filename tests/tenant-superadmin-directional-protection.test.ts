import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException, ForbiddenException } from "@nestjs/common";

import { UsersService } from "../src/modules/users/users.service";

const companyAdminContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "admin-a",
  roleCodes: ["company_admin"],
  permissions: ["users.read", "users.invite", "users.manage", "roles.assign"],
};

const superadminContext = {
  requestId: "request-b",
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
    { isEnabled: () => false, sendInviteEmail: async () => "skipped" } as never,
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

function assertForbidden(error: unknown): boolean {
  assert.ok(error instanceof ForbiddenException);
  assert.equal(
    (error.getResponse() as { code: string }).code,
    "ADMIN_MANAGEMENT_FORBIDDEN",
  );
  return true;
}

function assertSuperadminProtected(error: unknown): boolean {
  assert.ok(error instanceof ConflictException);
  assert.equal(
    (error.getResponse() as { code: string }).code,
    "SUPERADMIN_PROTECTED",
  );
  return true;
}

describe("tenant superadmin directional protection", () => {
  it("rejects a plain company_admin inviting another company_admin", async () => {
    const service = createService({
      user: { findUnique: async () => null },
    });

    await assert.rejects(
      () =>
        service.inviteUser(companyAdminContext as never, {
          email: "peer@example.com",
          roleCodes: ["company_admin"],
        }),
      assertForbidden,
    );
  });

  it("allows a plain company_admin to invite a team_manager", async () => {
    const service = createService({
      user: { findUnique: async () => null },
      invite: {
        create: async (query: { data: Record<string, unknown> }) => ({
          id: "invite-1",
          email: query.data.email,
          roleCodes: query.data.roleCodes,
          status: "pending",
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    });

    const invite = await service.inviteUser(companyAdminContext as never, {
      email: "manager@example.com",
      roleCodes: ["team_manager"],
    });

    assert.equal(invite.email, "manager@example.com");
  });

  it("rejects a plain company_admin granting the company_admin role", async () => {
    const service = createService({
      user: {
        findFirst: async () => ({
          id: "user-b",
          tenantId: "tenant-a",
          status: "active",
          deletedAt: null,
          roles: [{ roleCode: "team_manager" }],
        }),
      },
    });

    await assert.rejects(
      () =>
        service.addRole(companyAdminContext as never, "user-b", {
          roleCode: "company_admin",
        }),
      assertForbidden,
    );
  });

  it("rejects a plain company_admin removing another company_admin's role", async () => {
    const service = createService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "user-b",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [
              { roleCode: "company_admin" },
              { roleCode: "team_manager" },
            ],
          }),
        },
      }),
    );

    await assert.rejects(
      () =>
        service.removeRole(companyAdminContext as never, "user-b", "company_admin"),
      assertForbidden,
    );
  });

  it("rejects a plain company_admin deleting another company_admin", async () => {
    const service = createService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "user-b",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [{ roleCode: "company_admin" }],
          }),
        },
      }),
    );

    await assert.rejects(
      () => service.deleteUser(companyAdminContext as never, "user-b"),
      assertForbidden,
    );
  });

  it("rejects a company_admin resending a company_admin invite", async () => {
    const service = createService({
      invite: {
        findFirst: async () => ({
          id: "invite-1",
          email: "peer@example.com",
          roleCodes: ["company_admin"],
          status: "pending",
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    });

    await assert.rejects(
      () => service.resendInvite(companyAdminContext as never, "invite-1"),
      assertForbidden,
    );
  });

  it("rejects a company_admin resending a tenant_superadmin invite even with admin permissions", async () => {
    const service = createService({
      invite: {
        findFirst: async () => ({
          id: "invite-1",
          email: "super@example.com",
          roleCodes: ["tenant_superadmin"],
          status: "pending",
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    });

    await assert.rejects(
      () => service.resendInvite(superadminContext as never, "invite-1"),
      assertForbidden,
    );
  });

  for (const [label, targetContext] of [
    ["a plain company_admin", companyAdminContext],
    ["the superadmin itself", superadminContext],
  ] as const) {
    it(`rejects ${label} suspending the tenant superadmin`, async () => {
      const service = createService(
        withTransaction({
          user: {
            findFirst: async () => ({
              id: "superadmin-a",
              tenantId: "tenant-a",
              status: "active",
              deletedAt: null,
              roles: [{ roleCode: "tenant_superadmin" }],
            }),
          },
        }),
      );

      await assert.rejects(
        () =>
          service.updateUser(targetContext as never, "superadmin-a", {
            status: "suspended",
          }),
        assertSuperadminProtected,
      );
    });

    it(`rejects ${label} removing a role from the tenant superadmin`, async () => {
      const service = createService(
        withTransaction({
          user: {
            findFirst: async () => ({
              id: "superadmin-a",
              tenantId: "tenant-a",
              status: "active",
              deletedAt: null,
              roles: [{ roleCode: "tenant_superadmin" }],
            }),
          },
        }),
      );

      await assert.rejects(
        () =>
          service.removeRole(
            targetContext as never,
            "superadmin-a",
            "field_representative",
          ),
        assertSuperadminProtected,
      );
    });

    it(`rejects ${label} deleting the tenant superadmin`, async () => {
      const service = createService(
        withTransaction({
          user: {
            findFirst: async () => ({
              id: "superadmin-a",
              tenantId: "tenant-a",
              status: "active",
              deletedAt: null,
              roles: [{ roleCode: "tenant_superadmin" }],
            }),
          },
        }),
      );

      await assert.rejects(
        () => service.deleteUser(targetContext as never, "superadmin-a"),
        assertSuperadminProtected,
      );
    });
  }

  it("allows the superadmin to invite, suspend and delete a company_admin", async () => {
    const service = createService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "admin-b",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [{ roleCode: "company_admin" }],
          }),
          count: async () => 1,
          update: async () => ({
            id: "admin-b",
            email: "admin-b@example.com",
            name: "Admin B",
            phone: null,
            status: "suspended",
            lastSelectedRoleCode: null,
            roles: [{ roleCode: "company_admin" }],
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
            updatedAt: new Date("2026-07-04T00:00:00.000Z"),
          }),
        },
      }),
    );

    const updated = await service.updateUser(superadminContext as never, "admin-b", {
      status: "suspended",
    });

    assert.equal(updated.status, "suspended");
  });
});
