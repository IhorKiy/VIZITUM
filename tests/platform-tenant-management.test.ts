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
      status: "pilot",
      name: "Old Name",
    });
    const service = createPlatformService(store);

    const updated = await service.updateTenant("tenant-1", {
      name: "  New Name  ",
      status: "team",
      actorUserId: "owner-1",
    });

    assert.equal(updated.name, "New Name");
    assert.equal(updated.status, "team");
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.updated");
    assert.deepEqual(store.events[0]?.metadata, { fields: ["name", "status"] });
  });

  it("updates the primary contact fields and normalizes the email", async () => {
    const store = createStore({ id: "tenant-1", status: "pilot" });
    const service = createPlatformService(store);

    const updated = await service.updateTenant("tenant-1", {
      contactName: "  Olena Marchuk  ",
      contactEmail: "  Olena@Example.COM ",
      contactPhone: " +380 44 123 4567 ",
      actorUserId: "owner-1",
    });

    assert.equal(updated.contactName, "Olena Marchuk");
    assert.equal(updated.contactEmail, "olena@example.com");
    assert.equal(updated.contactPhone, "+380441234567");
    assert.deepEqual(store.events[0]?.metadata, {
      fields: ["contactName", "contactEmail", "contactPhone"],
    });
  });

  it("updates the phone country and validates a national phone against it", async () => {
    const store = createStore({ id: "tenant-1", status: "pilot" });
    const service = createPlatformService(store);

    const updated = await service.updateTenant("tenant-1", {
      phoneCountry: "de",
      contactPhone: "030 901820",
      actorUserId: "owner-1",
    });

    assert.equal(updated.phoneCountry, "DE");
    assert.equal(updated.contactPhone, "+4930901820");
  });

  it("rejects an invalid phone country on update", async () => {
    const store = createStore({ id: "tenant-1", status: "pilot" });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.updateTenant("tenant-1", { phoneCountry: "Germany" }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          fieldErrors: Record<string, string[]>;
        };
        assert.ok(response.fieldErrors.phoneCountry);
        return true;
      },
    );
  });

  it("rejects a contact phone that does not parse on update", async () => {
    const store = createStore({
      id: "tenant-1",
      status: "pilot",
      phoneCountry: "UA",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.updateTenant("tenant-1", { contactPhone: "not a phone" }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          fieldErrors: Record<string, string[]>;
        };
        assert.ok(response.fieldErrors.contactPhone);
        return true;
      },
    );
  });

  it("passes an unchanged legacy contact phone through without re-validation", async () => {
    const store = createStore({
      id: "tenant-1",
      status: "pilot",
      phoneCountry: "UA",
      contactPhone: "044-123 (legacy)",
    });
    const service = createPlatformService(store);

    const updated = await service.updateTenant("tenant-1", {
      contactName: "New Contact",
      contactPhone: "044-123 (legacy)",
      actorUserId: "owner-1",
    });

    assert.equal(updated.contactName, "New Contact");
    assert.equal(updated.contactPhone, "044-123 (legacy)");
  });

  it("rejects a malformed contact email on update", async () => {
    const store = createStore({ id: "tenant-1", status: "pilot" });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.updateTenant("tenant-1", { contactEmail: "not-an-email" }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "TENANT_UPDATE_INVALID");
        assert.ok(response.fieldErrors.contactEmail);
        return true;
      },
    );
  });

  it("rejects blanking a contact field to empty", async () => {
    const store = createStore({ id: "tenant-1", status: "pilot" });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.updateTenant("tenant-1", { contactEmail: "   " }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "TENANT_UPDATE_INVALID");
        assert.ok(response.fieldErrors.contactEmail);
        return true;
      },
    );
  });

  it("updates the country and trims it", async () => {
    const store = createStore({
      id: "tenant-1",
      status: "pilot",
      country: "UA",
    });
    const service = createPlatformService(store);

    const updated = await service.updateTenant("tenant-1", {
      country: "  PL  ",
      actorUserId: "owner-1",
    });

    assert.equal(updated.country, "PL");
    assert.deepEqual(store.events[0]?.metadata, { fields: ["country"] });
  });

  it("rejects blanking the country to empty", async () => {
    const store = createStore({
      id: "tenant-1",
      status: "pilot",
      country: "UA",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.updateTenant("tenant-1", { country: "   " }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "TENANT_UPDATE_INVALID");
        assert.ok(response.fieldErrors.country);
        return true;
      },
    );
  });

  it("updates the timezone to a valid IANA time zone", async () => {
    const store = createStore({
      id: "tenant-1",
      status: "pilot",
      timezone: "Europe/Kiev",
    });
    const service = createPlatformService(store);

    const updated = await service.updateTenant("tenant-1", {
      timezone: " America/New_York ",
      actorUserId: "owner-1",
    });

    assert.equal(updated.timezone, "America/New_York");
    assert.deepEqual(store.events[0]?.metadata, { fields: ["timezone"] });
  });

  it("canonicalizes timezone casing instead of storing the caller's literal string", async () => {
    const store = createStore({
      id: "tenant-1",
      status: "pilot",
      timezone: "Europe/Kiev",
    });
    const service = createPlatformService(store);
    const canonicalKyiv = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Kyiv",
    }).resolvedOptions().timeZone;

    const updated = await service.updateTenant("tenant-1", {
      timezone: "europe/kyiv",
    });

    assert.equal(updated.timezone, canonicalKyiv);
  });

  it("rejects a timezone that is not a real IANA time zone", async () => {
    const store = createStore({
      id: "tenant-1",
      status: "pilot",
      timezone: "Europe/Kiev",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.updateTenant("tenant-1", { timezone: "Not/A_Real_Zone" }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "TENANT_UPDATE_INVALID");
        assert.ok(response.fieldErrors.timezone);
        return true;
      },
    );
    assert.equal(store.tenant.timezone, "Europe/Kiev");
    assert.equal(store.events.length, 0);
  });

  it("updates the admin limit", async () => {
    const store = createStore({ id: "tenant-1", status: "pilot" });
    const service = createPlatformService(store);

    const updated = await service.updateTenant("tenant-1", {
      adminLimit: 5,
      actorUserId: "owner-1",
    });

    // Override wins over the pilot plan's cap of 0.
    assert.equal(updated.adminLimit, 5);
    assert.equal(updated.adminLimitOverride, 5);
    assert.deepEqual(store.events[0]?.metadata, { fields: ["adminLimit"] });
  });

  it("clears the admin limit override so the cap follows the plan", async () => {
    const store = createStore({
      id: "tenant-1",
      status: "team",
      adminLimit: 5,
    });
    const service = createPlatformService(store);

    const updated = await service.updateTenant("tenant-1", {
      adminLimit: null,
      actorUserId: "owner-1",
    });

    // Override cleared → effective cap derives from the team plan (1).
    assert.equal(updated.adminLimitOverride, null);
    assert.equal(updated.adminLimit, 1);
    assert.deepEqual(store.events[0]?.metadata, { fields: ["adminLimit"] });
  });

  it("rejects a non-positive-integer admin limit", async () => {
    const store = createStore({ id: "tenant-1", status: "pilot" });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.updateTenant("tenant-1", { adminLimit: 0 }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "TENANT_UPDATE_INVALID");
        assert.ok(response.fieldErrors.adminLimit);
        return true;
      },
    );
    assert.equal(store.events.length, 0);
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

  it("rejects setting status to the retired active status through update", async () => {
    const store = createStore({ id: "tenant-1", status: "pilot" });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.updateTenant("tenant-1", { status: "active" as never }),
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

  it("closes the archive race: does not duplicate the event when a concurrent request already archived the tenant", async () => {
    const store = createStore({ id: "tenant-1", status: "active" });
    // The outer check reads "active" and proceeds past the no-op fast path,
    // but by the time the transaction's conditional update runs, another
    // request has already archived the row.
    store.raceState.status = "archived";
    const service = createPlatformService(store);

    const result = await service.archiveTenant("tenant-1", {
      actorUserId: "owner-1",
    });

    assert.equal(result.status, "archived");
    assert.equal(store.events.length, 0);
  });

  it("unarchives a tenant to suspended and records a tenant.unarchived event", async () => {
    const store = createStore({
      id: "tenant-1",
      status: "archived",
      archivedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const service = createPlatformService(store);

    const restored = await service.unarchiveTenant("tenant-1", {
      actorUserId: "owner-1",
    });

    assert.equal(restored.status, "suspended");
    assert.equal(restored.archivedAt, null);
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.unarchived");
    assert.deepEqual(store.events[0]?.metadata, {
      restoredStatus: "suspended",
    });
  });

  it("is idempotent when unarchiving a tenant that isn't archived", async () => {
    const store = createStore({ id: "tenant-1", status: "active" });
    const service = createPlatformService(store);

    const result = await service.unarchiveTenant("tenant-1");

    assert.equal(result.status, "active");
    assert.equal(store.events.length, 0);
  });

  it("rejects unarchiving an unknown tenant", async () => {
    const store = createStore({ id: "tenant-1", status: "active" });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.unarchiveTenant("missing"),
      NotFoundException,
    );
  });

  it("closes the unarchive race: does not duplicate the event when a concurrent request already restored the tenant", async () => {
    const store = createStore({ id: "tenant-1", status: "archived" });
    // The outer check reads "archived" and proceeds past the no-op fast
    // path, but by the time the transaction's conditional update runs,
    // another request has already restored the row.
    store.raceState.status = "suspended";
    const service = createPlatformService(store);

    const result = await service.unarchiveTenant("tenant-1", {
      actorUserId: "owner-1",
    });

    assert.equal(result.status, "suspended");
    assert.equal(store.events.length, 0);
  });

  it("invites a tenant's first superadmin and records platform + audit events", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    const service = createPlatformService(store);

    const invite = await service.inviteOrReplaceTenantSuperadmin("tenant-1", {
      email: "super@example.com",
      actorUserId: "platform-owner-1",
      requestId: "request-1",
    });

    assert.equal(invite.email, "super@example.com");
    assert.equal(store.superadminInviteCalls.length, 1);
    assert.equal(store.superadminInviteCalls[0]?.context.tenantId, "tenant-1");
    assert.equal(
      store.superadminInviteCalls[0]?.context.tenantSlug,
      "pilot-a",
    );
    assert.equal(store.superadminInviteCalls[0]?.email, "super@example.com");
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.superadmin_invited");
    assert.equal(store.events[0]?.actorUserId, "platform-owner-1");
    assert.equal(store.auditEvents.length, 1);
    assert.equal(store.auditEvents[0]?.eventType, "superadmin.invited");
  });

  it("revokes any existing pending superadmin invite before creating a new one", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    const service = createPlatformService(store);

    await service.inviteOrReplaceTenantSuperadmin("tenant-1", {
      email: "replacement@example.com",
    });

    assert.equal(store.revokedPendingSuperadminInviteCalls.length, 1);
    assert.deepEqual(store.revokedPendingSuperadminInviteCalls[0], {
      tenantId: "tenant-1",
      status: "pending",
      roleCodes: { has: "tenant_superadmin" },
    });
  });

  it("rejects superadmin invites for archived tenants", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () =>
        service.inviteOrReplaceTenantSuperadmin("tenant-1", {
          email: "super@example.com",
        }),
      ConflictException,
    );

    assert.equal(store.superadminInviteCalls.length, 0);
    assert.equal(store.events.length, 0);
  });

  it("promotes an active Company Admin to superadmin and records platform + audit events", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    const service = createPlatformService(store);

    const promoted = await service.promoteToSuperadmin("tenant-1", {
      userId: "admin-1",
      actorUserId: "platform-owner-1",
      requestId: "request-1",
    });

    assert.equal(promoted.id, "admin-1");
    assert.equal(store.promoteCalls.length, 1);
    assert.equal(store.promoteCalls[0]?.userId, "admin-1");
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.superadmin_promoted");
    assert.equal(store.auditEvents.length, 1);
    assert.equal(store.auditEvents[0]?.eventType, "superadmin.promoted");
  });

  it("rejects promoting without a user id", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () => service.promoteToSuperadmin("tenant-1", {}),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "SUPERADMIN_CANDIDATE_INVALID",
        );
        return true;
      },
    );

    assert.equal(store.promoteCalls.length, 0);
    assert.equal(store.events.length, 0);
  });

  it("rejects promoting for archived tenants", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "archived",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () =>
        service.promoteToSuperadmin("tenant-1", { userId: "admin-1" }),
      ConflictException,
    );

    assert.equal(store.promoteCalls.length, 0);
  });

  it("propagates the promote guard (e.g. ADMIN_ROLE_REQUIRED) as-is", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    // Only an active Company Admin can be promoted: UsersService.promoteToSuperadmin
    // rejects otherwise, and the platform service must surface that as-is.
    store.promoteError = new BadRequestException({
      code: "ADMIN_ROLE_REQUIRED",
      message:
        "Only an active Company Admin can be promoted to tenant superadmin.",
    });
    const service = createPlatformService(store);

    await assert.rejects(
      () =>
        service.promoteToSuperadmin("tenant-1", { userId: "manager-1" }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "ADMIN_ROLE_REQUIRED",
        );
        return true;
      },
    );

    assert.equal(store.events.length, 0);
  });

  it("reports no active superadmin and no pending invite for a fresh tenant", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    const service = createPlatformService(store);

    const summary = await service.getTenantSuperadmin("tenant-1");

    assert.deepEqual(summary, { activeSuperadmin: null, pendingInvite: null });
  });

  it("reports the active superadmin and pending invite when present", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    store.superadmin = {
      id: "super-1",
      tenantId: "tenant-1",
      email: "super@example.com",
      name: "Super One",
      phone: null,
      status: "active",
      lastSelectedRoleCode: "tenant_superadmin",
      roles: [{ roleCode: "tenant_superadmin" }],
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    };
    store.pendingSuperadminInvite = {
      id: "invite-1",
      email: "next@example.com",
      roleCodes: ["tenant_superadmin"],
      status: "pending",
      // Relative so the invite stays in the future no matter when this runs —
      // a hardcoded date here turned into a time bomb once the clock passed it.
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      acceptedAt: null,
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      createdBy: null,
      acceptedBy: null,
    };
    const service = createPlatformService(store);

    const summary = await service.getTenantSuperadmin("tenant-1");

    assert.equal(summary.activeSuperadmin?.email, "super@example.com");
    assert.equal(summary.pendingInvite?.email, "next@example.com");
  });

  it("does not report a superadmin invite as pending once it has expired", async () => {
    const store = createStore({
      id: "tenant-1",
      slug: "pilot-a",
      status: "ready",
    });
    store.pendingSuperadminInvite = {
      id: "invite-1",
      email: "next@example.com",
      roleCodes: ["tenant_superadmin"],
      // Still "pending" in the DB — nothing transitions the row on expiry —
      // but expiresAt is in the past, so the console must not surface it as
      // an actionable pending invite.
      status: "pending",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      acceptedAt: null,
      createdAt: new Date("2019-12-25T00:00:00.000Z"),
      createdBy: null,
      acceptedBy: null,
    };
    const service = createPlatformService(store);

    const summary = await service.getTenantSuperadmin("tenant-1");

    assert.equal(summary.pendingInvite, null);
  });
});

function createStore(seed: Record<string, unknown> & { id: string }) {
  const tenant: Record<string, unknown> = {
    archivedAt: null,
    slug: "tenant-a",
    adminLimit: 2,
    ...seed,
  };
  const events: Array<Record<string, unknown>> = [];
  const auditEvents: Array<Record<string, unknown>> = [];
  const superadminInviteCalls: Array<{
    context: RequestContext;
    email: string;
  }> = [];
  const promoteCalls: Array<{ context: RequestContext; userId: string }> = [];
  const revokedPendingSuperadminInviteCalls: Array<Record<string, unknown>> =
    [];
  // When `status` is set, the next updateMany call applies it to the tenant
  // before checking its where clause, simulating a concurrent writer that
  // changed the row between the outer idempotency check and the
  // transactional conditional update.
  const raceState: { status?: string } = {};

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
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: string | { not: string } };
        data: Record<string, unknown>;
      }) => {
        if (raceState.status !== undefined) {
          tenant.status = raceState.status;
          raceState.status = undefined;
        }

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
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      },
    },
    invite: {
      updateMany: async ({
        where,
      }: {
        where: Record<string, unknown>;
      }) => {
        revokedPendingSuperadminInviteCalls.push(where);
        return { count: 0 };
      },
      findFirst: async () =>
        (store.pendingSuperadminInvite as Record<string, unknown>) ?? null,
    },
    user: {
      findFirst: async () =>
        (store.superadmin as Record<string, unknown>) ?? null,
    },
  };

  const prisma = {
    ...client,
    $transaction: async (callback: (tx: typeof client) => Promise<unknown>) =>
      callback(client),
  };

  const store = {
    prisma,
    tenant,
    events,
    auditEvents,
    superadminInviteCalls,
    promoteCalls,
    revokedPendingSuperadminInviteCalls,
    raceState,
    superadmin: undefined as Record<string, unknown> | undefined,
    pendingSuperadminInvite: undefined as Record<string, unknown> | undefined,
    // When set, UsersService.promoteToSuperadmin throws this instead of
    // succeeding, letting tests exercise how the platform service reacts to
    // a rejected promote (e.g. a non-admin candidate) without booting Nest DI.
    promoteError: undefined as unknown,
  };

  return store;
}

function createPlatformService(store: ReturnType<typeof createStore>) {
  const usersService = {
    inviteSuperadmin: async (context: RequestContext, email: string) => {
      store.superadminInviteCalls.push({ context, email });

      return {
        id: "invite-1",
        email,
        roleCodes: ["tenant_superadmin"],
        status: "pending",
        expiresAt: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        token: "invite-token",
      };
    },
    promoteToSuperadmin: async (
      context: RequestContext,
      userId: string,
    ) => {
      store.promoteCalls.push({ context, userId });

      if (store.promoteError) {
        throw store.promoteError;
      }

      return {
        id: userId,
        email: "promoted@example.com",
        name: "Promoted Admin",
        phone: null,
        status: "active",
        lastSelectedRoleCode: "tenant_superadmin",
        roleCodes: ["tenant_superadmin"],
        createdAt: new Date("2026-07-01T00:00:00.000Z").toISOString(),
        updatedAt: new Date("2026-07-01T00:00:00.000Z").toISOString(),
      };
    },
  } as unknown as UsersService;
  const auditService = {
    recordEvent: async (
      _context: RequestContext,
      input: Record<string, unknown>,
    ) => {
      store.auditEvents.push(input);
    },
  };

  return new PlatformService(
    store.prisma as unknown as PrismaService,
    usersService,
    auditService as never,
  );
}
