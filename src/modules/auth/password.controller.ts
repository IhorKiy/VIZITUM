import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";

import {
  PASSWORD_CHANGE_THROTTLE,
  PASSWORD_RESET_THROTTLE,
} from "../rate-limit/rate-limit.constants";

import type {
  ChangePasswordRequestBody,
  ForgotPasswordRequestBody,
  ResetPasswordRequestBody,
} from "./auth.types";
import { PasswordResetService } from "./password-reset.service";

/**
 * Password recovery and change.
 *
 * `forgot` and `reset` carry no session, so they are reachable signed out (and
 * CSRF-exempt by construction — applyCsrfProtection only engages once a session
 * cookie is present). `change` reads the session itself rather than declaring a
 * permission: there is no permission for acting on your own account, and every
 * signed-in user has one.
 *
 * All three are credential endpoints, so all three carry a hard per-IP cap on
 * top of whatever the service does per account. `forgot` and `reset` keep
 * their own finer-grained limits in password-reset.service.ts — the throttle
 * here is the floor that applies before any of that runs.
 */
@Controller("auth/password")
export class PasswordController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  @Post("forgot")
  @Throttle({
    default: {
      limit: PASSWORD_RESET_THROTTLE.limit,
      ttl: PASSWORD_RESET_THROTTLE.ttlSeconds * 1_000,
    },
  })
  @HttpCode(200)
  forgot(@Body() body: ForgotPasswordRequestBody, @Req() request: Request) {
    return this.passwordResetService.requestReset(body, request);
  }

  @Post("reset")
  @Throttle({
    default: {
      limit: PASSWORD_RESET_THROTTLE.limit,
      ttl: PASSWORD_RESET_THROTTLE.ttlSeconds * 1_000,
    },
  })
  @HttpCode(200)
  reset(@Body() body: ResetPasswordRequestBody, @Req() request: Request) {
    return this.passwordResetService.resetPassword(body, request);
  }

  @Post("change")
  @Throttle({
    default: {
      limit: PASSWORD_CHANGE_THROTTLE.limit,
      ttl: PASSWORD_CHANGE_THROTTLE.ttlSeconds * 1_000,
    },
  })
  @HttpCode(200)
  change(
    @Body() body: ChangePasswordRequestBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.passwordResetService.changePassword(body, request, response);
  }
}
