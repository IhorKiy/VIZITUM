import "reflect-metadata";
import "dotenv/config";
// Loads the Express.Request augmentation (context/requestId) the same way
// main.ts does: ts-node only type-checks the imported graph, so without this
// the controllers pulled in via AppModule fail to compile under ts-node even
// though `tsc -p` (which compiles the whole include set) is fine.
import "./types/express";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { JsonLogger } from "./common/json-logger.service";
import { AiService } from "./modules/ai/ai.service";
import {
  resolvePilotAutoArchiveDays,
  resolveTenantPurgeRetentionDays,
  TenantPurgeService,
} from "./modules/platform/tenant-purge.service";
import { StorageService } from "./modules/storage/storage.service";

type WorkerTask = "cleanup" | "purge";

async function bootstrap() {
  const logger = new JsonLogger();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger,
  });
  const task = parseWorkerTask(process.env.WORKER_TASK);

  try {
    if (task === "cleanup") {
      const result = await runCleanup(
        app.get(AiService),
        app.get(StorageService),
      );

      logger.log(
        {
          message: "worker_cleanup_completed",
          ...result,
        },
        "Worker",
      );

      if (result.storage.failedObjectCount > 0) {
        process.exitCode = 1;
      }
    }

    if (task === "purge") {
      const result = await runPurge(app.get(TenantPurgeService));

      logger.log(
        {
          message: "worker_purge_completed",
          ...result,
        },
        "Worker",
      );

      if (result.purge.failedTenantCount > 0) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    logger.error(
      {
        message: "worker_task_failed",
        task,
        errorMessage: error instanceof Error ? error.message : "Worker failed.",
      },
      error instanceof Error ? error.stack : undefined,
      "Worker",
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

async function runCleanup(
  aiService: AiService,
  storageService: StorageService,
) {
  const now = new Date();
  const [ai, storage] = await Promise.all([
    aiService.cleanupExpiredFailedAiJobs(now),
    storageService.cleanupExpiredTemporaryObjects(now),
  ]);

  return {
    task: "cleanup" as const,
    timestamp: now.toISOString(),
    ai,
    storage,
  };
}

// Tenant lifecycle pass: auto-archive stale pilots (opt-in via
// TENANT_PILOT_AUTO_ARCHIVE_DAYS), then purge archived tenants whose
// retention window elapsed or whose purge was explicitly requested. Env
// vars are resolved up front so a misconfigured value aborts before any
// destructive work starts.
async function runPurge(tenantPurgeService: TenantPurgeService) {
  const now = new Date();
  const retentionDays = resolveTenantPurgeRetentionDays(
    process.env.TENANT_PURGE_RETENTION_DAYS,
  );
  const autoArchiveDays = resolvePilotAutoArchiveDays(
    process.env.TENANT_PILOT_AUTO_ARCHIVE_DAYS,
  );

  const autoArchive = await tenantPurgeService.autoArchiveStalePilots(now, {
    autoArchiveDays,
  });
  const purge = await tenantPurgeService.purgeEligibleTenants(now, {
    retentionDays,
  });

  return {
    task: "purge" as const,
    timestamp: now.toISOString(),
    retentionDays,
    autoArchiveDays,
    autoArchive,
    purge,
  };
}

function parseWorkerTask(value: string | undefined): WorkerTask {
  if (!value || value === "cleanup") {
    return "cleanup";
  }

  if (value === "purge") {
    return "purge";
  }

  throw new Error(`Unsupported WORKER_TASK: ${value}`);
}

void bootstrap();
