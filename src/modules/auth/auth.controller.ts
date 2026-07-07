import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { AuthService } from "./auth.service";
import type {
  AcceptInviteRequestBody,
  LoginRequestBody,
  SwitchRoleRequestBody,
} from "./auth.types";
import { clearCsrfCookie } from "./csrf";
import { clearSessionCookie, readSessionToken } from "./session-cookie";
import { SessionService } from "./session.service";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(SessionService)
    private readonly sessionService: SessionService,
  ) {}

  @Post("login")
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

  @Post("role")
  @HttpCode(200)
  switchRole(@Body() body: SwitchRoleRequestBody, @Req() request: Request) {
    return this.authService.switchRole(body, request);
  }

  @Post("invites/accept")
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
    clearCsrfCookie(response);

    return { ok: true };
  }
}
