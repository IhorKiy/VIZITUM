import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";

import { PlatformService } from "../src/modules/platform/platform.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";

// The primary contact is required on every new tenant, so the success-path
// tests below all supply a valid contact; the failure-path tests omit or
// override individual fields to pin the validation.
const validContact = {
  contactName: "Olena Marchuk",
  contactEmail: "olena@example.com",
  contactPhone: "+380 44 123 4567",
};

describe("platform tenant creation", () => {
  it("rejects a tenant with a missing name, slug, segment template or contact details", async () => {
    const service = new PlatformService(createPrismaStub() as unknown as PrismaService);

    await assert.rejects(
      () =>
        service.createTenant({
          name: "",
          slug: "",
          segmentTemplate: undefined as never,
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as { fieldErrors: Record<string, string[]> };
        assert.ok(response.fieldErrors.name);
        assert.ok(response.fieldErrors.slug);
        assert.ok(response.fieldErrors.segmentTemplate);
        assert.ok(response.fieldErrors.contactName);
        assert.ok(response.fieldErrors.contactEmail);
        assert.ok(response.fieldErrors.contactPhone);
        return true;
      },
    );
  });

  it("persists the primary contact and normalizes the contact email", async () => {
    const prisma = createPrismaStub();
    const service = new PlatformService(prisma as unknown as PrismaService);

    const created = await service.createTenant({
      name: "Acme Co",
      slug: "acme",
      segmentTemplate: "distribution",
      contactName: "  Olena Marchuk  ",
      contactEmail: "  Olena@Example.COM ",
      contactPhone: " +380 44 123 4567 ",
    });

    assert.equal(created.tenant.contactName, "Olena Marchuk");
    assert.equal(created.tenant.contactEmail, "olena@example.com");
    assert.equal(created.tenant.contactPhone, "+380 44 123 4567");
  });

  it("rejects a malformed contact email", async () => {
    const service = new PlatformService(
      createPrismaStub() as unknown as PrismaService,
    );

    await assert.rejects(
      () =>
        service.createTenant({
          name: "Acme Co",
          slug: "acme",
          segmentTemplate: "distribution",
          ...validContact,
          contactEmail: "not-an-email",
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          fieldErrors: Record<string, string[]>;
        };
        assert.ok(response.fieldErrors.contactEmail);
        return true;
      },
    );
  });

  it("rejects a timezone that is not a real IANA time zone", async () => {
    const service = new PlatformService(createPrismaStub() as unknown as PrismaService);

    await assert.rejects(
      () =>
        service.createTenant({
          name: "Acme Co",
          slug: "acme",
          segmentTemplate: "distribution",
          timezone: "Not/A_Real_Zone",
          ...validContact,
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as { fieldErrors: Record<string, string[]> };
        assert.ok(response.fieldErrors.timezone);
        return true;
      },
    );
  });

  it("canonicalizes the selected timezone and falls back to the same canonical default when omitted", async () => {
    // Both assertions compare against whatever this runtime's zone database
    // resolves "Europe/Kyiv" to (canonical "Europe/Kyiv" on newer ICU,
    // legacy-alias "Europe/Kiev" on older ICU) instead of a hardcoded
    // literal, so the test can't drift from the actual normalizeTimezone
    // behavior it exercises.
    const canonicalKyiv = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Kyiv",
    }).resolvedOptions().timeZone;
    const service = new PlatformService(createPrismaStub() as unknown as PrismaService);

    const withTimezone = await service.createTenant({
      name: "Acme Co",
      slug: "acme",
      segmentTemplate: "distribution",
      timezone: " europe/kyiv ",
      ...validContact,
    });
    assert.equal(withTimezone.tenant.timezone, canonicalKyiv);

    const withoutTimezone = await service.createTenant({
      name: "Beta Co",
      slug: "beta",
      segmentTemplate: "distribution",
      ...validContact,
    });
    assert.equal(withoutTimezone.tenant.timezone, canonicalKyiv);
  });

  it("rejects a duplicate slug", async () => {
    const prisma = createPrismaStub({ existingTenant: { id: "tenant-existing" } });
    const service = new PlatformService(prisma as unknown as PrismaService);

    await assert.rejects(
      () =>
        service.createTenant({
          name: "Acme Co",
          slug: "acme",
          segmentTemplate: "distribution",
          ...validContact,
        }),
      ConflictException,
    );
  });

  it("creates a tenant that is immediately on the pilot plan", async () => {
    const prisma = createPrismaStub();
    const service = new PlatformService(prisma as unknown as PrismaService);

    const result = await service.createTenant({
      name: "Acme Co",
      slug: "Acme ",
      segmentTemplate: "distribution",
      actorUserId: "platform-owner",
      requestId: "req-1",
      ...validContact,
    });

    assert.equal(result.tenant.slug, "acme");
    assert.equal(result.tenant.status, "pilot");
  });

  it("lists and fetches tenants", async () => {
    const prisma = createPrismaStub();
    const service = new PlatformService(prisma as unknown as PrismaService);

    const created = await service.createTenant({
      name: "Acme Co",
      slug: "acme",
      segmentTemplate: "distribution",
      ...validContact,
    });

    const listed = await service.listTenants();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, created.tenant.id);

    const fetched = await service.getTenant(created.tenant.id);
    assert.equal(fetched.tenant.id, created.tenant.id);
    // No provisioning job is created anymore, so there's nothing to find.
    assert.equal(fetched.provisioningJob, null);
  });

  it("batches each tenant's superadmin summary into listTenants instead of requiring a separate call per tenant", async () => {
    const prisma = createPrismaStub();
    const service = new PlatformService(prisma as unknown as PrismaService);

    const active = await service.createTenant({
      name: "Acme Co",
      slug: "acme",
      segmentTemplate: "distribution",
      ...validContact,
    });
    const archived = await service.createTenant({
      name: "Retired Co",
      slug: "retired",
      segmentTemplate: "distribution",
      ...validContact,
    });
    await prisma.platformTenant.update({
      where: { id: archived.tenant.id },
      data: { status: "archived" },
    });

    prisma.seedSuperadmin(active.tenant.id, {
      id: "super-1",
      tenantId: active.tenant.id,
      email: "super@example.com",
      name: "Super One",
      phone: null,
      status: "active",
      lastSelectedRoleCode: "tenant_superadmin",
      roles: [{ roleCode: "tenant_superadmin" }],
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    prisma.seedPendingInvite(archived.tenant.id, {
      id: "invite-1",
      tenantId: archived.tenant.id,
      email: "next@example.com",
      roleCodes: ["tenant_superadmin"],
      status: "pending",
      expiresAt: new Date("2026-07-14T00:00:00.000Z"),
      acceptedAt: null,
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      createdBy: null,
      acceptedBy: null,
    });

    const listed = await service.listTenants();
    const activeEntry = listed.find((tenant) => tenant.id === active.tenant.id);
    const archivedEntry = listed.find(
      (tenant) => tenant.id === archived.tenant.id,
    );

    assert.equal(activeEntry?.superadmin?.activeSuperadmin?.email, "super@example.com");
    assert.equal(activeEntry?.superadmin?.pendingInvite, null);
    // Archived tenants can't be managed, so their summary is always empty —
    // even though a pending invite row was seeded for one above, to prove it
    // isn't surfaced once the tenant is archived.
    assert.deepEqual(archivedEntry?.superadmin, null);
  });
});

function createPrismaStub(options: { existingTenant?: { id: string } } = {}) {
  const tenants: Array<Record<string, unknown>> = [];
  const superadminsByTenantId = new Map<string, Record<string, unknown>>();
  const pendingInvitesByTenantId = new Map<string, Record<string, unknown>>();
  let idCounter = 0;

  return {
    platformTenant: {
      findUnique: async ({ where }: { where: { slug?: string; id?: string } }) => {
        if (where.slug) {
          if (options.existingTenant) {
            return options.existingTenant;
          }
          return tenants.find((tenant) => tenant.slug === where.slug) ?? null;
        }
        return tenants.find((tenant) => tenant.id === where.id) ?? null;
      },
      findMany: async () => [...tenants].reverse(),
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const tenant = tenants.find((entry) => entry.id === where.id);
        if (tenant) {
          Object.assign(tenant, data);
        }
        return tenant;
      },
    },
    platformProvisioningJob: {
      findFirst: async () => null,
    },
    userRole: {
      groupBy: async () => [],
    },
    visit: {
      groupBy: async () => [],
    },
    product: {
      groupBy: async () => [],
    },
    location: {
      groupBy: async () => [],
    },
    user: {
      findMany: async ({
        where,
      }: {
        where: { tenantId: { in: string[] } };
      }) =>
        where.tenantId.in
          .map((tenantId) => superadminsByTenantId.get(tenantId))
          .filter((user): user is Record<string, unknown> => Boolean(user)),
    },
    invite: {
      findMany: async ({
        where,
      }: {
        where: { tenantId: { in: string[] } };
      }) =>
        where.tenantId.in
          .map((tenantId) => pendingInvitesByTenantId.get(tenantId))
          .filter(
            (invite): invite is Record<string, unknown> => Boolean(invite),
          ),
    },
    seedSuperadmin: (tenantId: string, user: Record<string, unknown>) => {
      superadminsByTenantId.set(tenantId, user);
    },
    seedPendingInvite: (tenantId: string, invite: Record<string, unknown>) => {
      pendingInvitesByTenantId.set(tenantId, invite);
    },
    $transaction: async (
      callback: (tx: {
        platformTenant: { create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>> };
        productCapability: { createMany: (args: unknown) => Promise<void> };
        platformOperationEvent: { create: (args: unknown) => Promise<void> };
      }) => Promise<unknown>,
    ) => {
      const tx = {
        platformTenant: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            idCounter += 1;
            const tenant = { id: `tenant-${idCounter}`, createdAt: new Date(), ...data };
            tenants.push(tenant);
            return tenant;
          },
        },
        productCapability: {
          createMany: async () => undefined,
        },
        platformOperationEvent: {
          create: async () => undefined,
        },
      };

      return callback(tx);
    },
  };
}
