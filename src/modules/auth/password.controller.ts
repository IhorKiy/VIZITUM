import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

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
 */
@Controller("auth/password")
export class PasswordController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  @Post("forgot")
  @HttpCode(200)
  forgot(@Body() body: ForgotPasswordRequestBody, @Req() request: Request) {
    return this.passwordResetService.requestReset(body, request);
  }

  @Post("reset")
  @HttpCode(200)
  reset(@Body() body: ResetPasswordRequestBody, @Req() request: Request) {
    return this.passwordResetService.resetPassword(body, request);
  }

  @Post("change")
  @HttpCode(200)
  change(
    @Body() body: ChangePasswordRequestBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.passwordResetService.changePassword(body, request, response);
  }
}
