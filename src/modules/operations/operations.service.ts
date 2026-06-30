import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { OperationsSummaryResponse } from "./operations.types";

const SUMMARY_WINDOW_HOURS = 24;

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(now = new Date()): Promise<OperationsSummaryResponse> {
    const windowStart = new Date(
      now.getTime() - SUMMARY_WINDOW_HOURS * 60 * 60 * 1000,
    );
    const [
      tenantsByStatus,
      queuedProvisioning,
      runningProvisioning,
      failedProvisioningRecent,
      failedImportsRecent,
      validationFailedImportsRecent,
      pendingImportConfirmation,
      queuedAiJobs,
      runningAiJobs,
      failedAiJobsRecent,
      expiredFailedAiJobs,
      expiredTemporaryStorage,
      deletedTemporaryStorageRecent,
    ] = await Promise.all([
      this.prisma.platformTenant.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma.platformProvisioningJob.count({
        where: { status: "queued" },
      }),
      this.prisma.platformProvisioningJob.count({
        where: { status: "running" },
      }),
      this.prisma.platformProvisioningJob.count({
        where: { status: "failed", updatedAt: { gte: windowStart } },
      }),
      this.prisma.importJob.count({
        where: { status: "failed", updatedAt: { gte: windowStart } },
      }),
      this.prisma.importJob.count({
        where: {
          status: "validation_failed",
          updatedAt: { gte: windowStart },
        },
      }),
      this.prisma.importJob.count({
        where: { status: "validated" },
      }),
      this.prisma.aiJob.count({
        where: { status: "queued" },
      }),
      this.prisma.aiJob.count({
        where: { status: "running" },
      }),
      this.prisma.aiJob.count({
        where: { status: "failed", updatedAt: { gte: windowStart } },
      }),
      this.prisma.aiJob.count({
        where: { status: "failed", expiresAt: { lte: now } },
      }),
      this.prisma.storageObject.count({
        where: {
          status: "expired",
          deletedAt: null,
          expiresAt: { lte: now },
          purpose: { in: ["temporary_audio", "temporary_transcript"] },
        },
      }),
      this.prisma.storageObject.count({
        where: {
          status: "deleted",
          deletedAt: { gte: windowStart },
          purpose: { in: ["temporary_audio", "temporary_transcript"] },
        },
      }),
    ]);
    const tenantsByStatusMap = Object.fromEntries(
      tenantsByStatus.map((group) => [group.status, group._count._all]),
    );
    const tenantTotal = tenantsByStatus.reduce(
      (total, group) => total + group._count._all,
      0,
    );

    return {
      generatedAt: now.toISOString(),
      windowHours: SUMMARY_WINDOW_HOURS,
      tenants: {
        total: tenantTotal,
        byStatus: tenantsByStatusMap,
      },
      provisioning: {
        queued: queuedProvisioning,
        running: runningProvisioning,
        failedRecent: failedProvisioningRecent,
      },
      imports: {
        failedRecent: failedImportsRecent,
        validationFailedRecent: validationFailedImportsRecent,
        pendingConfirmation: pendingImportConfirmation,
      },
      ai: {
        queued: queuedAiJobs,
        running: runningAiJobs,
        failedRecent: failedAiJobsRecent,
        expiredFailedAwaitingCleanup: expiredFailedAiJobs,
      },
      storage: {
        expiredTemporaryAwaitingCleanup: expiredTemporaryStorage,
        deletedRecent: deletedTemporaryStorageRecent,
      },
    };
  }
}
