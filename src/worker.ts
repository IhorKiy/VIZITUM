import "reflect-metadata";
import "dotenv/config";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { JsonLogger } from "./common/json-logger.service";
import { AiService } from "./modules/ai/ai.service";
import { StorageService } from "./modules/storage/storage.service";

type WorkerTask = "cleanup";

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

function parseWorkerTask(value: string | undefined): WorkerTask {
  if (!value || value === "cleanup") {
    return "cleanup";
  }

  throw new Error(`Unsupported WORKER_TASK: ${value}`);
}

void bootstrap();
