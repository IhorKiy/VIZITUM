import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";

import { UsersService } from "../src/modules/users/users.service";

// Existing tenants (created before the tenant_superadmin role existed) have
// Company Admins but no superadmin yet. Until the platform owner invites or
// promotes one, the anti-lockout rule falls back to the pre-existing "keep
// at least one active company_admin" behavior so those tenants aren't
// bricked.
const superadminlessContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "admin-a",
  // A tenant with no superadmin can only reach these admin-management code
  // paths via a Company Admin holding admins.invite/admins.manage — not
  // realistic under the final permission matrix, but that's exactly the
  // migration gap this fallback covers: these actor permissions stand in
  // for "whoever the platform owner grants admin management to" until the
  // tenant's first superadmin exists.
  roleCodes: ["company_admin"],
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

function assertLastAdmin(error: unknown): boolean {
  assert.ok(error instanceof ConflictException);
  assert.equal(
    (error.getResponse() as { code: string }).code,
    "TENANT_LAST_ADMIN",
  );
  return true;
}

describe("tenant superadmin bootstrap fallback", () => {
  it("blocks suspending the last active company_admin when the tenant has no superadmin yet", async () => {
    const service = createService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "admin-a",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [{ roleCode: "company_admin" }],
          }),
          count: async (query: {
            where: { roles: { some: { roleCode: string } } };
          }) => (query.where.roles.some.roleCode === "tenant_superadmin" ? 0 : 0),
        },
      }),
    );

    await assert.rejects(
      () =>
        service.updateUser(superadminlessContext as never, "admin-a", {
          status: "suspended",
        }),
      assertLastAdmin,
    );
  });

  it("blocks removing the company_admin role from the last active admin when the tenant has no superadmin yet", async () => {
    const service = createService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "admin-a",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [
              { roleCode: "company_admin" },
              { roleCode: "team_manager" },
            ],
          }),
          count: async () => 0,
        },
      }),
    );

    await assert.rejects(
      () =>
        service.removeRole(superadminlessContext as never, "admin-a", "company_admin"),
      assertLastAdmin,
    );
  });

  it("blocks deleting the last active company_admin when the tenant has no superadmin yet", async () => {
    const service = createService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "admin-a",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [{ roleCode: "company_admin" }],
          }),
          count: async () => 0,
        },
      }),
    );

    await assert.rejects(
      () => service.deleteUser(superadminlessContext as never, "admin-a"),
      assertLastAdmin,
    );
  });

  it("allows suspending a company_admin when another active admin remains, even without a superadmin", async () => {
    const service = createService(
      withTransaction({
        user: {
          findFirst: async () => ({
            id: "admin-a",
            tenantId: "tenant-a",
            status: "active",
            deletedAt: null,
            roles: [{ roleCode: "company_admin" }],
          }),
          count: async (query: {
            where: { roles: { some: { roleCode: string } } };
          }) =>
            query.where.roles.some.roleCode === "tenant_superadmin" ? 0 : 1,
          update: async () => ({
            id: "admin-a",
            email: "admin-a@example.com",
            name: "Admin A",
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

    const updated = await service.updateUser(
      superadminlessContext as never,
      "admin-a",
      { status: "suspended" },
    );

    assert.equal(updated.status, "suspended");
  });
});
