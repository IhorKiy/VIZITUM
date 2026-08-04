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
import {
  INVITE_ACCEPT_THROTTLE,
  LOGIN_THROTTLE,
} from "../rate-limit/rate-limit.constants";
import {
  AcceptInviteDto,
  LoginDto,
  SwitchRoleDto,
  SwitchZoneDto,
} from "./auth.dto";
import { AuthService } from "./auth.service";

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
  // Tier 6 (the credential surfaces) of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  // The pipe runs *after* the throttle above, which is a guard, so a refused
  // body has still been charged for; and AuthService refuses the same class of
  // body before it records anything, so nothing here can become an unlogged
  // attempt. See auth.dto.ts.
  @UsePipes(createStrictValidationPipe())
  login(
    @Body() body: LoginDto,
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
  @UsePipes(createStrictValidationPipe())
  switchRole(
    @Body() body: SwitchRoleDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.switchRole(body, request, response);
  }

  @Post("zone")
  @HttpCode(200)
  @UsePipes(createStrictValidationPipe())
  switchZone(
    @Body() body: SwitchZoneDto,
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
  @UsePipes(createStrictValidationPipe())
  acceptInvite(
    @Body() body: AcceptInviteDto,
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
