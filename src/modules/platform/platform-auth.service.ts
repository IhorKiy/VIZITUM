import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { PlatformUser } from "@prisma/client";
import type { Request, Response } from "express";

import { normalizeEmail } from "../../common/normalize";
import { AuthAuditService } from "../auth/auth-audit.service";
import type { PlatformLoginMethod } from "../auth/auth-audit.service";
import {
  clearCsrfCookie,
  createCsrfToken,
  writeCsrfCookie,
} from "../auth/csrf";
import { PasswordService } from "../auth/password.service";
import { TurnstileService } from "../auth/turnstile.service";
import { PrismaService } from "../prisma/prisma.service";
import { LoginBackoffService } from "../rate-limit/login-backoff.service";
import { ROLE_PERMISSION_MATRIX } from "../roles/role-permission.matrix";
import { PLATFORM_CSRF_COOKIE_NAME } from "./platform-auth.constants";
import { PlatformMfaService } from "./platform-mfa.service";
import { PLATFORM_OWNER_ROLE_CODE } from "./platform-auth.types";
import type {
  PlatformLoginRequestBody,
  PlatformLoginResponse,
  PlatformMfaEnrollRequestBody,
  PlatformMfaEnrollResponse,
  PlatformMfaVerifyRequestBody,
  PlatformSessionResponse,
} from "./platform-auth.types";
import {
  clearPlatformSessionCookie,
  readPlatformSessionToken,
  writePlatformSessionCookie,
} from "./platform-session-cookie";
import { PlatformSessionService } from "./platform-session.service";

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly platformSessionService: PlatformSessionService,
    private readonly turnstileService: TurnstileService,
    private readonly loginBackoffService: LoginBackoffService,
    private readonly platformMfaService: PlatformMfaService,
    private readonly authAuditService: AuthAuditService,
  ) {}

  /**
   * First step only. A correct password never yields a session on its own:
   * one platform account reaches every tenant's data, so it is exactly the
   * account a password alone should not be enough for.
   */
  async login(
    body: PlatformLoginRequestBody,
    request: Request,
  ): Promise<PlatformLoginResponse> {
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      throwInvalidCredentials();
    }

    // Same ordering rationale as the tenant login: captcha before any
    // database work.
    await this.turnstileService.assertValidToken(body.captchaToken);

    const platformUser = await this.prisma.platformUser.findUnique({
      where: { email },
    });

    if (!platformUser || platformUser.status !== "active") {
      await this.loginBackoffService.penalizeFailure("platform-login", email);
      await this.authAuditService.recordPlatformLoginFailed({
        platformUserId: platformUser?.id ?? null,
        email,
        requestId: request.requestId,
        reason: platformUser ? "inactive_account" : "unknown_account",
      });
      throwInvalidCredentials();
    }

    const passwordMatches = await this.passwordService.verifyPassword(
      platformUser.passwordHash,
      password,
    );

    if (!passwordMatches) {
      await this.loginBackoffService.penalizeFailure("platform-login", email);
      await this.authAuditService.recordPlatformLoginFailed({
        platformUserId: platformUser.id,
        email,
        requestId: request.requestId,
        reason: "wrong_password",
      });
      throwInvalidCredentials();
    }

    await this.loginBackoffService.clearFailures("platform-login", email);

    if (!this.platformMfaService.isEnrolled(platformUser)) {
      // No confirmed authenticator yet. The answer is an enrolment offer
      // rather than a session, so an unenrolled account cannot simply keep
      // signing in with a password forever.
      const offer = await this.platformMfaService.issueEnrollmentChallenge(
        platformUser.id,
        platformUser.email,
      );

      return {
        step: "mfa-enrollment",
        challengeToken: offer.token,
        expiresAt: offer.expiresAt.toISOString(),
        secret: offer.secret,
        otpauthUrl: offer.otpauthUrl,
      };
    }

    const challenge = await this.platformMfaService.issueLoginChallenge(
      platformUser.id,
    );

    return {
      step: "mfa",
      challengeToken: challenge.token,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  /** Second step for an owner who already has an authenticator. */
  async verifyMfa(
    body: PlatformMfaVerifyRequestBody,
    request: Request,
    response: Response,
  ): Promise<{ step: "session" } & PlatformSessionResponse> {
    const challenge = await this.platformMfaService.claimChallenge(
      body.challengeToken,
      "login",
    );
    const platformUser = await this.loadActivePlatformUser(
      challenge.platformUserId,
    );

    if (!platformUser.totpSecret) {
      throwChallengeInvalid();
    }

    const accepted = body.recoveryCode
      ? await this.platformMfaService.consumeRecoveryCode(
          platformUser.id,
          platformUser.totpRecoveryCodeHashes,
          body.recoveryCode,
        )
      : this.platformMfaService.verifyTotpCode(
          platformUser.totpSecret,
          body.code,
        );

    if (!accepted) {
      // The code is a credential, so a wrong one earns the same growing delay
      // a wrong password does. The challenge is already consumed, so the
      // owner starts the sign-in again — which is the point: a six-digit code
      // must not be guessable at speed.
      await this.loginBackoffService.penalizeFailure(
        "platform-login",
        platformUser.email,
      );
      await this.authAuditService.recordPlatformLoginFailed({
        platformUserId: platformUser.id,
        email: platformUser.email,
        requestId: request.requestId,
        reason: "wrong_code",
        method: body.recoveryCode ? "recovery_code" : "totp",
      });
      throw new BadRequestException({
        code: "MFA_CODE_INVALID",
        message: "That code is not valid. Sign in again.",
      });
    }

    return this.issueSession(
      platformUser,
      request,
      response,
      body.recoveryCode ? "recovery_code" : "totp",
    );
  }

  /**
   * Second step for an owner who had no authenticator: the code proves the
   * app holds the pending secret, and only then is the account enrolled.
   * Returns the recovery codes, once.
   */
  async completeEnrollment(
    body: PlatformMfaEnrollRequestBody,
    request: Request,
    response: Response,
  ): Promise<PlatformMfaEnrollResponse> {
    const challenge = await this.platformMfaService.claimChallenge(
      body.challengeToken,
      "enrollment",
    );

    if (!challenge.pendingSecret) {
      throwChallengeInvalid();
    }

    const platformUser = await this.loadActivePlatformUser(
      challenge.platformUserId,
    );
    const recoveryCodes = await this.platformMfaService.confirmEnrollment(
      platformUser.id,
      challenge.pendingSecret,
      body.code,
    );
    const session = await this.issueSession(
      platformUser,
      request,
      response,
      "enrollment",
    );

    return { ...session, recoveryCodes };
  }

  // Here rather than in the controller for the same reason the tenant logout
  // is: who signed out has to be resolved before the revocation that makes
  // the session unfindable.
  async logout(request: Request, response: Response): Promise<{ ok: true }> {
    const token = readPlatformSessionToken(request);

    if (token) {
      const session =
        await this.platformSessionService.findActiveSessionByToken(token);

      await this.platformSessionService.revokeSessionByToken(token);

      if (session) {
        await this.authAuditService.recordPlatformLoggedOut({
          platformUserId: session.platformUserId,
          requestId: request.requestId,
        });
      }
    }

    clearPlatformSessionCookie(response);
    clearCsrfCookie(response, PLATFORM_CSRF_COOKIE_NAME);

    return { ok: true };
  }

  async getCurrentPlatformUser(
    request: Request,
  ): Promise<PlatformSessionResponse> {
    const token = readPlatformSessionToken(request);

    if (!token) {
      throwUnauthenticated();
    }

    const session =
      await this.platformSessionService.findActiveSessionByToken(token);

    if (!session) {
      throwUnauthenticated();
    }

    const { platformUser } = session;

    if (!platformUser || platformUser.status !== "active") {
      throwUnauthenticated();
    }

    return toSessionResponse(platformUser);
  }

  private async loadActivePlatformUser(
    platformUserId: string,
  ): Promise<PlatformUser> {
    const platformUser = await this.prisma.platformUser.findUnique({
      where: { id: platformUserId },
    });

    // Re-read rather than trusted from the first step: the account may have
    // been suspended in the minutes the challenge was outstanding.
    if (!platformUser || platformUser.status !== "active") {
      throwInvalidCredentials();
    }

    return platformUser;
  }

  private async issueSession(
    platformUser: PlatformUser,
    request: Request,
    response: Response,
    method: PlatformLoginMethod,
  ): Promise<{ step: "session" } & PlatformSessionResponse> {
    const { token } = await this.platformSessionService.createSession({
      platformUserId: platformUser.id,
      userAgent: request.header("user-agent"),
      ipAddress: request.ip,
    });

    await this.prisma.platformUser.update({
      where: { id: platformUser.id },
      data: { lastLoginAt: new Date() },
    });

    writePlatformSessionCookie(response, token);
    writeCsrfCookie(
      response,
      createCsrfToken(token),
      PLATFORM_CSRF_COOKIE_NAME,
    );

    // The one place a platform session is minted, so the one place the
    // trail records a completed sign-in — both the ordinary code step and the
    // enrolment step that also issues a session pass through here.
    await this.authAuditService.recordPlatformLoginSucceeded({
      platformUserId: platformUser.id,
      email: platformUser.email,
      requestId: request.requestId,
      method,
    });

    return { step: "session", ...toSessionResponse(platformUser) };
  }
}

function toSessionResponse(platformUser: {
  id: string;
  email: string;
  name: string;
  status: string;
  totpRecoveryCodeHashes?: string[];
}): PlatformSessionResponse {
  return {
    platformUser: {
      id: platformUser.id,
      email: platformUser.email,
      name: platformUser.name,
      status: platformUser.status,
    },
    roleCodes: [PLATFORM_OWNER_ROLE_CODE],
    permissions: [...ROLE_PERMISSION_MATRIX.platform_owner],
    // A count, never the codes themselves — those exist in plaintext only on
    // the response that mints them.
    ...(platformUser.totpRecoveryCodeHashes
      ? { recoveryCodesRemaining: platformUser.totpRecoveryCodeHashes.length }
      : {}),
  };
}

function throwInvalidCredentials(): never {
  throw new UnauthorizedException({
    code: "INVALID_CREDENTIALS",
    message: "Email or password is incorrect.",
  });
}

function throwChallengeInvalid(): never {
  throw new BadRequestException({
    code: "MFA_CHALLENGE_INVALID",
    message: "This sign-in attempt has expired. Start again.",
  });
}

function throwUnauthenticated(): never {
  throw new UnauthorizedException({
    code: "AUTHENTICATION_REQUIRED",
    message: "Authentication is required.",
  });
}
