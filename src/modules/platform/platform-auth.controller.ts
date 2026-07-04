import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { clearCsrfCookie } from "../auth/csrf";
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

  @Post("login")
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
    clearCsrfCookie(response);

    return { ok: true };
  }
}
