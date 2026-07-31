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

import {
  INVITE_ACCEPT_THROTTLE,
  LOGIN_THROTTLE,
  PASSWORD_CHANGE_THROTTLE,
} from "../rate-limit/rate-limit.constants";
import { AuthService } from "./auth.service";
import type {
  AcceptInviteRequestBody,
  ChangePasswordRequestBody,
  LoginRequestBody,
  SwitchRoleRequestBody,
  SwitchZoneRequestBody,
} from "./auth.types";
import { CSRF_COOKIE_NAME } from "./auth.constants";
import { clearCsrfCookie } from "./csrf";
import { clearSessionCookie, readSessionToken } from "./session-cookie";
import { SessionService } from "./session.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  // Overrides the permissive global throttle with the tight per-IP cap. The
  // per-account half of the control is the progressive delay inside
  // AuthService — see rate-limit.constants.ts for why one is hard and the
  // other is not.
  @Post("login")
  @Throttle({
    default: {
      limit: LOGIN_THROTTLE.limit,
      ttl: LOGIN_THROTTLE.ttlSeconds * 1_000,
    },
  })
  @HttpCode(200)
  login(
    @Body() body: LoginRequestBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.login(body, request, response);
  }

  @Get("me")
  me(@Req() request: Request) {
    return this.authService.getCurrentUser(request);
  }

  // Both switches change what the session is allowed to do, so both rotate
  // the session token and therefore need the response to set cookies on.
  @Post("role")
  @HttpCode(200)
  switchRole(
    @Body() body: SwitchRoleRequestBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.switchRole(body, request, response);
  }

  @Post("zone")
  @HttpCode(200)
  switchZone(
    @Body() body: SwitchZoneRequestBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.switchZone(body, request, response);
  }

  // Authenticated, but still a credential endpoint: it verifies the current
  // password, so it gets the same per-IP cap and per-account backoff the
  // login routes do.
  @Post("password")
  @Throttle({
    default: {
      limit: PASSWORD_CHANGE_THROTTLE.limit,
      ttl: PASSWORD_CHANGE_THROTTLE.ttlSeconds * 1_000,
    },
  })
  @HttpCode(200)
  changePassword(
    @Body() body: ChangePasswordRequestBody,
    @Req() request: Request,
  ) {
    return this.authService.changePassword(body, request);
  }

  @Post("invites/accept")
  @Throttle({
    default: {
      limit: INVITE_ACCEPT_THROTTLE.limit,
      ttl: INVITE_ACCEPT_THROTTLE.ttlSeconds * 1_000,
    },
  })
  @HttpCode(200)
  acceptInvite(
    @Body() body: AcceptInviteRequestBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.acceptInvite(body, request, response);
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readSessionToken(request);

    if (token) {
      await this.sessionService.revokeSessionByToken(token);
    }

    clearSessionCookie(response);
    clearCsrfCookie(response, CSRF_COOKIE_NAME);

    return { ok: true };
  }
}
