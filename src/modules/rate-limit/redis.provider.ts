import { Logger } from "@nestjs/common";
import Redis from "ioredis";

export const RATE_LIMIT_REDIS = Symbol("RATE_LIMIT_REDIS");

// Injected as `Redis | null`: null means "no Redis configured", which every
// consumer handles by falling back to per-process memory.
export type RateLimitRedis = Redis | null;

const logger = new Logger("RateLimitRedis");

// Counters that live only in one process reset on every deploy and are not
// shared between instances — a restart hands an in-flight guesser a clean
// slate, and a second instance doubles every limit. Redis is already part of
// the deployed stack (REDIS_URL is a documented production variable), so the
// counters go there whenever it is configured.
//
// Production must configure it, and refuses to boot without it — that gate
// lives in auth/security-config.ts alongside the other silently-degrading
// controls. Local dev, tests and e2e need no Redis and get the memory path.
export function createRateLimitRedis(
  env: NodeJS.ProcessEnv = process.env,
): RateLimitRedis {
  const url = env.REDIS_URL?.trim();

  if (!url) {
    logger.log(
      "REDIS_URL is not set — auth rate-limit counters will live in this process's memory only.",
    );

    return null;
  }

  const client = new Redis(url, {
    // Fail a command rather than queueing it forever when Redis is down: the
    // callers below all degrade gracefully, and a stuck command would stall
    // the login request it is guarding.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
  });

  // ioredis emits 'error' on the client; an unhandled one takes the process
  // down. Rate limiting is defence in depth, so a Redis outage must degrade,
  // never crash the API.
  client.on("error", (error: Error) => {
    logger.error(`Redis connection error: ${error.message}`);
  });

  return client;
}
