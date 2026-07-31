import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";

import { ApiThrottlerGuard } from "./api-throttler.guard";
import { createAttemptStore } from "./attempt-store";
import { LoginBackoffService } from "./login-backoff.service";
import { RateLimitRedisModule } from "./rate-limit-redis.module";
import { GLOBAL_THROTTLE } from "./rate-limit.constants";
import { ATTEMPT_STORE } from "./rate-limit.tokens";
import { RATE_LIMIT_REDIS, type RateLimitRedis } from "./redis.provider";

// Global so `@Throttle(...)` resolves on any controller and the two auth
// services can inject LoginBackoffService without importing this module.
@Global()
@Module({
  imports: [
    RateLimitRedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RateLimitRedisModule],
      inject: [RATE_LIMIT_REDIS],
      useFactory: (redis: RateLimitRedis) => ({
        throttlers: [
          {
            name: "default",
            limit: GLOBAL_THROTTLE.limit,
            ttl: GLOBAL_THROTTLE.ttlSeconds * 1_000,
          },
        ],
        // Omitted when no Redis is configured, which leaves the library's
        // in-memory storage in place for local dev, tests and e2e.
        ...(redis ? { storage: new ThrottlerStorageRedisService(redis) } : {}),
      }),
    }),
  ],
  providers: [
    {
      provide: ATTEMPT_STORE,
      inject: [RATE_LIMIT_REDIS],
      useFactory: (redis: RateLimitRedis) => createAttemptStore(redis),
    },
    LoginBackoffService,
    {
      provide: APP_GUARD,
      useClass: ApiThrottlerGuard,
    },
  ],
  exports: [ATTEMPT_STORE, LoginBackoffService],
})
export class RateLimitModule {}
