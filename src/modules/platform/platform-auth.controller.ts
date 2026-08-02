import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";

import { PLATFORM_LOGIN_THROTTLE } from "../rate-limit/rate-limit.constants";
import { PlatformAuthService } from "./platform-auth.service";
import type {
  PlatformLoginRequestBody,
  PlatformMfaEnrollRequestBody,
  PlatformMfaVerifyRequestBody,
} from "./platform-auth.types";

@Controller("platform/auth")
export class PlatformAuthController {
  constructor(private readonly platformAuthService: PlatformAuthService) {}

  // Tighter than the tenant login: one account exists, it reaches every
  // tenant's data, and nothing legitimate signs into it in a loop.
  @Post("login")
  @Throttle({
    default: {
      limit: PLATFORM_LOGIN_THROTTLE.limit,
      ttl: PLATFORM_LOGIN_THROTTLE.ttlSeconds * 1_000,
    },
  })
  @HttpCode(200)
  login(@Body() body: PlatformLoginRequestBody, @Req() request: Request) {
    // No response to write: the password step no longer issues a session, so
    // there are no cookies to set until the code step. The request is here for
    // the audit trail's request id, not for a cookie.
    return this.platformAuthService.login(body, request);
  }

  // The second step. Same per-IP cap as the password step: a six-digit code
  // is only strong while it cannot be guessed at speed.
  @Post("mfa")
  @Throttle({
    default: {
      limit: PLATFORM_LOGIN_THROTTLE.limit,
      ttl: PLATFORM_LOGIN_THROTTLE.ttlSeconds * 1_000,
    },
  })
  @HttpCode(200)
  verifyMfa(
    @Body() body: PlatformMfaVerifyRequestBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.platformAuthService.verifyMfa(body, request, response);
  }

  @Post("mfa/enroll")
  @Throttle({
    default: {
      limit: PLATFORM_LOGIN_THROTTLE.limit,
      ttl: PLATFORM_LOGIN_THROTTLE.ttlSeconds * 1_000,
    },
  })
  @HttpCode(200)
  completeEnrollment(
    @Body() body: PlatformMfaEnrollRequestBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.platformAuthService.completeEnrollment(body, request, response);
  }

  @Get("me")
  me(@Req() request: Request) {
    return this.platformAuthService.getCurrentPlatformUser(request);
  }

  @Post("logout")
  @HttpCode(200)
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.platformAuthService.logout(request, response);
  }
}
