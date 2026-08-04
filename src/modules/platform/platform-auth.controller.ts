import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UsePipes,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";

import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { PLATFORM_LOGIN_THROTTLE } from "../rate-limit/rate-limit.constants";
import {
  PlatformLoginDto,
  PlatformMfaEnrollDto,
  PlatformMfaVerifyDto,
} from "./platform-auth.dto";
import { PlatformAuthService } from "./platform-auth.service";

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
  // Tier 6 (the credential surfaces) of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped per route, not global. The two
  // code steps below validate nothing beyond the envelope on purpose; see
  // platform-auth.dto.ts.
  @UsePipes(createStrictValidationPipe())
  login(@Body() body: PlatformLoginDto, @Req() request: Request) {
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
  @UsePipes(createStrictValidationPipe())
  verifyMfa(
    @Body() body: PlatformMfaVerifyDto,
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
  @UsePipes(createStrictValidationPipe())
  completeEnrollment(
    @Body() body: PlatformMfaEnrollDto,
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
