import "reflect-metadata";
import "dotenv/config";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { JsonLogger } from "./common/json-logger.service";
import { AiService } from "./modules/ai/ai.service";
import { ProvisioningService } from "./modules/platform/provisioning.service";
import { StorageService } from "./modules/storage/storage.service";

type WorkerTask = "cleanup" | "provision";

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
    } else if (task === "provision") {
      const result = await runProvision(app.get(ProvisioningService));

      logger.log(
        {
          message: "worker_provision_completed",
          ...result,
        },
        "Worker",
      );

      if (result.provisioning.failedJobCount > 0) {
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

async function runProvision(provisioningService: ProvisioningService) {
  const now = new Date();
  const provisioning =
    await provisioningService.runPendingProvisioningJobs(now);

  return {
    task: "provision" as const,
    timestamp: now.toISOString(),
    provisioning,
  };
}

function parseWorkerTask(value: string | undefined): WorkerTask {
  if (!value || value === "cleanup") {
    return "cleanup";
  }

  if (value === "provision") {
    return "provision";
  }

  throw new Error(`Unsupported WORKER_TASK: ${value}`);
}

void bootstrap();
