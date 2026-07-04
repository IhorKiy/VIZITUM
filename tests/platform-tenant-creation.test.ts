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

  it("creates a draft tenant with a queued provisioning job", async () => {
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
    assert.equal(result.tenant.status, "draft");
    assert.equal(result.provisioningJob.status, "queued");
    assert.equal(result.provisioningJob.tenantId, result.tenant.id);
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
    assert.equal(fetched.provisioningJob?.id, created.provisioningJob.id);
  });
});

function createPrismaStub(options: { existingTenant?: { id: string } } = {}) {
  const tenants: Array<Record<string, unknown>> = [];
  const provisioningJobs: Array<Record<string, unknown>> = [];
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
      findFirst: async ({ where }: { where: { tenantId: string } }) =>
        provisioningJobs
          .filter((job) => job.tenantId === where.tenantId)
          .slice(-1)[0] ?? null,
    },
    $transaction: async (
      callback: (tx: {
        platformTenant: { create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>> };
        platformProvisioningJob: { create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>> };
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
        platformProvisioningJob: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            idCounter += 1;
            const job = { id: `job-${idCounter}`, createdAt: new Date(), ...data };
            provisioningJobs.push(job);
            return job;
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
