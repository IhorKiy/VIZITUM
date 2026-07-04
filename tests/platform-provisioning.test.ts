import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProvisioningService } from "../src/modules/platform/provisioning.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";

describe("platform provisioning", () => {
  it("advances a queued job and moves a draft tenant to ready", async () => {
    const store = createStore({
      tenant: { id: "tenant-1", status: "draft" },
      job: { id: "job-1", tenantId: "tenant-1", status: "queued" },
      capabilityCount: 4,
    });
    const service = new ProvisioningService(
      store.prisma as unknown as PrismaService,
    );

    const result = await service.runPendingProvisioningJobs(
      new Date("2026-07-04T12:00:00.000Z"),
    );

    assert.deepEqual(result, {
      inspectedJobCount: 1,
      provisionedJobCount: 1,
      failedJobCount: 0,
    });
    assert.equal(store.tenant.status, "ready");
    assert.equal(store.job.status, "succeeded");
    assert.equal(store.job.step, "ready");
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.provisioned");
  });

  it("does not drag an already-active tenant back to ready", async () => {
    const store = createStore({
      tenant: { id: "tenant-1", status: "active" },
      job: { id: "job-1", tenantId: "tenant-1", status: "queued" },
      capabilityCount: 4,
    });
    const service = new ProvisioningService(
      store.prisma as unknown as PrismaService,
    );

    const result = await service.runPendingProvisioningJobs();

    assert.equal(result.provisionedJobCount, 1);
    assert.equal(store.tenant.status, "active");
    assert.equal(store.job.status, "succeeded");
  });

  it("fails the job when the tenant has no seeded capabilities", async () => {
    const store = createStore({
      tenant: { id: "tenant-1", status: "draft" },
      job: { id: "job-1", tenantId: "tenant-1", status: "queued" },
      capabilityCount: 0,
    });
    const service = new ProvisioningService(
      store.prisma as unknown as PrismaService,
    );

    const result = await service.runPendingProvisioningJobs();

    assert.deepEqual(result, {
      inspectedJobCount: 1,
      provisionedJobCount: 0,
      failedJobCount: 1,
    });
    assert.equal(store.tenant.status, "draft");
    assert.equal(store.job.status, "failed");
    assert.equal(store.job.errorCode, "CAPABILITIES_MISSING");
  });

  it("returns zero counts when no jobs are queued", async () => {
    const store = createStore({
      tenant: { id: "tenant-1", status: "ready" },
      job: { id: "job-1", tenantId: "tenant-1", status: "succeeded" },
      capabilityCount: 4,
    });
    const service = new ProvisioningService(
      store.prisma as unknown as PrismaService,
    );

    const result = await service.runPendingProvisioningJobs();

    assert.deepEqual(result, {
      inspectedJobCount: 0,
      provisionedJobCount: 0,
      failedJobCount: 0,
    });
  });
});

function createStore(options: {
  tenant: { id: string; status: string };
  job: { id: string; tenantId: string; status: string; step?: string };
  capabilityCount: number;
}) {
  const tenant = { productMode: "team", ...options.tenant };
  const job: Record<string, unknown> = { ...options.job };
  const events: Array<Record<string, unknown>> = [];

  const client = {
    platformProvisioningJob: {
      findMany: async ({ where }: { where: { status: string } }) =>
        job.status === where.status
          ? [{ id: job.id, tenantId: job.tenantId }]
          : [],
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(job, data);
        return job;
      },
    },
    platformTenant: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === tenant.id ? tenant : null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(tenant, data);
        return tenant;
      },
    },
    productCapability: {
      count: async () => options.capabilityCount,
    },
    platformOperationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      },
    },
  };

  const prisma = {
    ...client,
    $transaction: async (callback: (tx: typeof client) => Promise<unknown>) =>
      callback(client),
  };

  return { prisma, tenant, job, events };
}
