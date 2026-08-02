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
} from "../rate-limit/rate-limit.constants";
import { AuthService } from "./auth.service";
import type {
  AcceptInviteRequestBody,
  LoginRequestBody,
  SwitchRoleRequestBody,
  SwitchZoneRequestBody,
} from "./auth.types";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.logout(request, response);
  }
}
