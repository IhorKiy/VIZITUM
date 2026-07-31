import { ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { ThrottlerLimitDetail } from "@nestjs/throttler";
import type { Request } from "express";

import { isRateLimitDisabled } from "./rate-limit.constants";

// Global throttler with three deviations from the stock guard:
//
//  1. Tracking keys on `request.ip`, which is only the caller's real address
//     once `trust proxy` is set in the bootstrap — see resolveTrustProxyHops.
//  2. An explicit off switch for the Playwright suite, which drives many
//     parallel logins from one loopback address.
//  3. A rejection shaped like every other API error (`code` + `message`), with
//     Retry-After, instead of the library's bare "Too Many Requests" string.
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (isRateLimitDisabled()) {
      return true;
    }

    return super.shouldSkip(context);
  }

  // Promise-returning to match the base signature, but there is nothing to
  // await — the address is already on the request.
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;

    return Promise.resolve(
      request.ip ?? request.socket?.remoteAddress ?? "unknown-client-address",
    );
  }

  protected throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    // timeToBlockExpire is the one that matters once blocked; timeToExpire
    // only describes the counting window, which has already been exceeded.
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(
        throttlerLimitDetail.timeToBlockExpire ||
          throttlerLimitDetail.timeToExpire,
      ),
    );
    const response = context.switchToHttp().getResponse<{
      header?: (name: string, value: string) => void;
    }>();

    response.header?.("Retry-After", String(retryAfterSeconds));

    throw new HttpException(
      {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait and try again.",
        details: { retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
