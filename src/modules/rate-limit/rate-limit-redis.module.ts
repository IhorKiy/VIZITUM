import {
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from "@nestjs/common";

import {
  RATE_LIMIT_REDIS,
  createRateLimitRedis,
  type RateLimitRedis,
} from "./redis.provider";

// Closes the shared connection on shutdown so a restarting process doesn't
// leave a socket behind. ThrottlerStorageRedisService only disconnects
// clients it created itself, and this one is handed to it, so the ownership
// stays here.
@Injectable()
class RateLimitRedisLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(RATE_LIMIT_REDIS) private readonly redis: RateLimitRedis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}

// Its own module, imported by both RateLimitModule and the async
// ThrottlerModule factory inside it, so the throttler storage and the
// failed-login counters share one connection instead of opening two. Nest
// caches module instances, so the double import resolves to the same
// provider.
@Module({
  providers: [
    {
      provide: RATE_LIMIT_REDIS,
      useFactory: () => createRateLimitRedis(),
    },
    RateLimitRedisLifecycle,
  ],
  exports: [RATE_LIMIT_REDIS],
})
export class RateLimitRedisModule {}
