import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";

import { UsersService } from "../src/modules/users/users.service";
import {
  adminCapForStatus,
  resolveAdminCap,
} from "../src/modules/users/users.types";

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

async function invite(
  tenant: { adminLimit: number | null; status: string },
  activeAdmins: number,
) {
  const created: unknown[] = [];
  const service = createService({
    user: {
      findUnique: async () => null,
      count: async () => activeAdmins,
    },
    platformTenant: {
      findUnique: async () => tenant,
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

  await service.inviteUser(superadminContext as never, {
    email: "admin@example.com",
    roleCodes: ["company_admin"],
  });

  return created.length;
}

describe("admin cap derived from plan tier", () => {
  it("maps each plan tier to its Company Admin cap", () => {
    assert.equal(adminCapForStatus("pilot"), 0);
    assert.equal(adminCapForStatus("team"), 1);
    assert.equal(adminCapForStatus("business"), 2);
    assert.equal(adminCapForStatus("suspended"), 0);
  });

  it("falls back to the default cap for non-plan statuses", () => {
    // Transient/legacy statuses must not silently lock a tenant to zero.
    assert.equal(adminCapForStatus("active"), 2);
    assert.equal(adminCapForStatus("ready"), 2);
  });

  it("prefers an explicit override over the plan-derived cap", () => {
    assert.equal(resolveAdminCap({ status: "pilot", adminLimit: 3 }), 3);
    assert.equal(resolveAdminCap({ status: "business", adminLimit: 1 }), 1);
    // Null override → derive from plan.
    assert.equal(resolveAdminCap({ status: "team", adminLimit: null }), 1);
  });

  it("blocks a company_admin invite on a pilot tenant (cap 0)", async () => {
    await assert.rejects(
      () => invite({ adminLimit: null, status: "pilot" }, 0),
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

  it("allows one company_admin on a team tenant, then blocks the second", async () => {
    assert.equal(await invite({ adminLimit: null, status: "team" }, 0), 1);

    await assert.rejects(
      () => invite({ adminLimit: null, status: "team" }, 1),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        return true;
      },
    );
  });

  it("lets an owner override lift a pilot tenant above its plan cap", async () => {
    // Deliberate per-tenant exception: cap 2 despite the pilot plan's 0.
    assert.equal(await invite({ adminLimit: 2, status: "pilot" }, 1), 1);
  });
});
