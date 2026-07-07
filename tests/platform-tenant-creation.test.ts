import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";

import { PlatformService } from "../src/modules/platform/platform.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";

describe("platform tenant creation", () => {
  it("rejects a tenant with a missing name, slug or segment template", async () => {
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
    });
    assert.equal(withTimezone.tenant.timezone, canonicalKyiv);

    const withoutTimezone = await service.createTenant({
      name: "Beta Co",
      slug: "beta",
      segmentTemplate: "distribution",
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
    });

    const listed = await service.listTenants();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, created.tenant.id);

    const fetched = await service.getTenant(created.tenant.id);
    assert.equal(fetched.tenant.id, created.tenant.id);
    // No provisioning job is created anymore, so there's nothing to find.
    assert.equal(fetched.provisioningJob, null);
  });
});

function createPrismaStub(options: { existingTenant?: { id: string } } = {}) {
  const tenants: Array<Record<string, unknown>> = [];
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
