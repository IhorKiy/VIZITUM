import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UsersService } from "../src/modules/users/users.service";

// Once a tenant has an active tenant_superadmin, the Company Admin count is
// free to drop to zero — the superadmin alone can operate the tenant, and
// the old "keep at least one active company_admin" rule only applies as a
// bootstrap fallback for tenants without a superadmin yet (see
// tenant-superadmin-bootstrap-fallback.test.ts).
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

describe("tenant superadmin lockout", () => {
  it("allows suspending the tenant's last active company_admin once a superadmin is active", async () => {
    let sawSuperadminCountQuery = false;
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
          }) => {
            if (query.where.roles.some.roleCode === "tenant_superadmin") {
              sawSuperadminCountQuery = true;
              return 1;
            }

            throw new Error("must not fall through to the admin count");
          },
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

    const updated = await service.updateUser(superadminContext as never, "admin-a", {
      status: "suspended",
    });

    assert.equal(updated.status, "suspended");
    assert.ok(sawSuperadminCountQuery);
  });

  it("allows removing the company_admin role from the tenant's last active admin once a superadmin is active", async () => {
    const deletedRoles: unknown[] = [];
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
      }),
    );

    await service.removeRole(superadminContext as never, "admin-a", "company_admin");

    assert.equal(deletedRoles.length, 1);
  });

  it("allows deleting the tenant's last active company_admin once a superadmin is active", async () => {
    let updateData: unknown;
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
          count: async () => 1,
          update: async (query: { data: unknown }) => {
            updateData = query.data;
            return {};
          },
        },
      }),
    );

    const result = await service.deleteUser(superadminContext as never, "admin-a");

    assert.deepEqual(result, { id: "admin-a", status: "deleted" });
    assert.deepEqual(updateData, {
      status: "deleted",
      deletedAt: (updateData as { deletedAt: Date }).deletedAt,
    });
    assert.ok((updateData as { deletedAt: Date }).deletedAt instanceof Date);
  });
});
