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

import { clearCsrfCookie } from "../auth/csrf";
import { PLATFORM_LOGIN_THROTTLE } from "../rate-limit/rate-limit.constants";
import { PLATFORM_CSRF_COOKIE_NAME } from "./platform-auth.constants";
import { PlatformAuthService } from "./platform-auth.service";
import type { PlatformLoginRequestBody } from "./platform-auth.types";
import {
  clearPlatformSessionCookie,
  readPlatformSessionToken,
} from "./platform-session-cookie";
import { PlatformSessionService } from "./platform-session.service";

@Controller("platform/auth")
export class PlatformAuthController {
  constructor(
    private readonly platformAuthService: PlatformAuthService,
    private readonly platformSessionService: PlatformSessionService,
  ) {}

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
  login(
    @Body() body: PlatformLoginRequestBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.platformAuthService.login(body, request, response);
  }

  @Get("me")
  me(@Req() request: Request) {
    return this.platformAuthService.getCurrentPlatformUser(request);
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readPlatformSessionToken(request);

    if (token) {
      await this.platformSessionService.revokeSessionByToken(token);
    }

    clearPlatformSessionCookie(response);
    clearCsrfCookie(response, PLATFORM_CSRF_COOKIE_NAME);

    return { ok: true };
  }
}
