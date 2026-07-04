import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

export type ProvisioningRunResult = {
  inspectedJobCount: number;
  provisionedJobCount: number;
  failedJobCount: number;
};

const PROVISIONING_BATCH_SIZE = 25;

// Tenant statuses from which provisioning may legitimately advance a tenant to
// `ready`. A tenant that has moved past provisioning (active/suspended/archived)
// must never be dragged back by a stale queued job.
const ADVANCEABLE_TENANT_STATUSES = ["draft", "provisioning"] as const;

@Injectable()
export class ProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  async runPendingProvisioningJobs(
    now = new Date(),
  ): Promise<ProvisioningRunResult> {
    const queuedJobs = await this.prisma.platformProvisioningJob.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take: PROVISIONING_BATCH_SIZE,
      select: { id: true, tenantId: true },
    });

    let provisionedJobCount = 0;
    let failedJobCount = 0;

    for (const job of queuedJobs) {
      const advanced = await this.provisionJob(job.id, job.tenantId, now);

      if (advanced) {
        provisionedJobCount += 1;
      } else {
        failedJobCount += 1;
      }
    }

    return {
      inspectedJobCount: queuedJobs.length,
      provisionedJobCount,
      failedJobCount,
    };
  }

  private async provisionJob(
    jobId: string,
    tenantId: string,
    now: Date,
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.platformTenant.findUnique({
          where: { id: tenantId },
          select: { id: true, status: true, productMode: true },
        });

        if (!tenant) {
          await tx.platformProvisioningJob.update({
            where: { id: jobId },
            data: {
              status: "failed",
              step: "failed",
              startedAt: now,
              finishedAt: now,
              errorCode: "TENANT_NOT_FOUND",
              errorMessage: "Tenant no longer exists.",
            },
          });

          return false;
        }

        await tx.platformProvisioningJob.update({
          where: { id: jobId },
          data: { status: "running", step: "provisioning", startedAt: now },
        });

        const isAdvanceable = ADVANCEABLE_TENANT_STATUSES.includes(
          tenant.status as (typeof ADVANCEABLE_TENANT_STATUSES)[number],
        );

        // The tenant already carries its seeded capabilities from creation, so
        // provisioning here is the state-machine step that marks it ready. Real
        // per-tenant infrastructure work would slot in before this transition.
        const capabilityCount = await tx.productCapability.count({
          where: { tenantId },
        });

        if (capabilityCount === 0) {
          await tx.platformProvisioningJob.update({
            where: { id: jobId },
            data: {
              status: "failed",
              step: "failed",
              finishedAt: now,
              errorCode: "CAPABILITIES_MISSING",
              errorMessage: "Tenant has no seeded product capabilities.",
            },
          });

          return false;
        }

        if (isAdvanceable) {
          await tx.platformTenant.update({
            where: { id: tenantId },
            data: { status: "ready" },
          });
        }

        await tx.platformProvisioningJob.update({
          where: { id: jobId },
          data: { status: "succeeded", step: "ready", finishedAt: now },
        });

        await tx.platformOperationEvent.create({
          data: {
            tenantId,
            eventType: "tenant.provisioned",
            metadata: {
              provisioningJobId: jobId,
              tenantStatus: isAdvanceable ? "ready" : tenant.status,
            },
          },
        });

        return true;
      });
    } catch (error) {
      await this.prisma.platformProvisioningJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          step: "failed",
          finishedAt: now,
          errorCode: "PROVISIONING_FAILED",
          errorMessage:
            error instanceof Error ? error.message : "Provisioning failed.",
        },
      });

      return false;
    }
  }
}
