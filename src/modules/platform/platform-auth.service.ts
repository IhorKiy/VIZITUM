import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { PlatformUser } from "@prisma/client";
import type { Request, Response } from "express";

import { normalizeEmail } from "../../common/normalize";
import { describeRequestOrigin } from "../../common/request-origin";
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
        origin: describeRequestOrigin(request),
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
        origin: describeRequestOrigin(request),
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
    const method = body.recoveryCode ? "recovery_code" : "totp";
    const challenge = await this.claimChallengeAudited(
      body.challengeToken,
      "login",
      request,
      method,
    );
    const platformUser = await this.loadActivePlatformUser(
      challenge.platformUserId,
    );

    if (!platformUser.totpSecret) {
      // Reached only for an account whose secret vanished between the two
      // steps; the identity is known here, unlike at claim time.
      await this.recordChallengeRejected(request, method, {
        platformUserId: platformUser.id,
        email: platformUser.email,
      });
      throwChallengeInvalid();
    }

    const accepted = body.recoveryCode
      ? await this.platformMfaService.consumeRecoveryCode(
          platformUser.id,
          platformUser.totpRecoveryCodeHashes,
          body.recoveryCode,
        )
      : await this.platformMfaService.acceptTotpCode(
          { id: platformUser.id, totpSecret: platformUser.totpSecret },
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
        origin: describeRequestOrigin(request),
        reason: "wrong_code",
        method,
      });
      throw new BadRequestException({
        code: "MFA_CODE_INVALID",
        message: "That code is not valid. Sign in again.",
      });
    }

    return this.issueSession(platformUser, request, response, method);
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
    const challenge = await this.claimChallengeAudited(
      body.challengeToken,
      "enrollment",
      request,
      "enrollment",
    );

    if (!challenge.pendingSecret) {
      await this.recordChallengeRejected(request, "enrollment", {
        platformUserId: challenge.platformUserId,
      });
      throwChallengeInvalid();
    }

    const platformUser = await this.loadActivePlatformUser(
      challenge.platformUserId,
    );
    const recoveryCodes = await this.confirmEnrollmentAudited(
      platformUser,
      challenge.pendingSecret,
      body.code,
      request,
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
          origin: describeRequestOrigin(request),
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

  /**
   * Claims a challenge, recording the refusal when it is rejected.
   *
   * A rejected challenge — expired, already spent, or claimed for the other
   * step — is the one sign-in failure that left no trace at all, and a run of
   * them is somebody replaying captured tokens rather than guessing digits.
   * Nothing is known about who it was at this point: the token is the only
   * identity a challenge has, and it did not resolve.
   */
  private async claimChallengeAudited(
    token: unknown,
    purpose: "login" | "enrollment",
    request: Request,
    method: PlatformLoginMethod,
  ) {
    try {
      return await this.platformMfaService.claimChallenge(token, purpose);
    } catch (error) {
      await this.recordChallengeRejected(request, method, {
        platformUserId: null,
      });

      throw error;
    }
  }

  /**
   * Confirms enrolment, recording a rejected code.
   *
   * Enrolment is a sign-in: it ends in a session. Its wrong-code path was the
   * one that wrote nothing, so somebody working through codes against the
   * enrolment step left no trace while the same attempt against the login
   * step did.
   */
  private async confirmEnrollmentAudited(
    platformUser: PlatformUser,
    pendingSecret: string,
    code: unknown,
    request: Request,
  ): Promise<string[]> {
    try {
      return await this.platformMfaService.confirmEnrollment(
        platformUser.id,
        pendingSecret,
        code,
      );
    } catch (error) {
      // Narrowed to the rejected code: anything else (a database failure, say)
      // is not a failed sign-in attempt and must not be recorded as one.
      if (isMfaCodeInvalid(error)) {
        await this.authAuditService.recordPlatformLoginFailed({
          platformUserId: platformUser.id,
          email: platformUser.email,
          requestId: request.requestId,
          reason: "wrong_code",
          method: "enrollment",
        });
      }

      throw error;
    }
  }

  private async recordChallengeRejected(
    request: Request,
    method: PlatformLoginMethod,
    identity: { platformUserId: string | null; email?: string },
  ): Promise<void> {
    await this.authAuditService.recordPlatformLoginFailed({
      platformUserId: identity.platformUserId,
      ...(identity.email ? { email: identity.email } : {}),
      requestId: request.requestId,
      origin: describeRequestOrigin(request),
      reason: "invalid_challenge",
      method,
    });
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
      origin: describeRequestOrigin(request),
      method,
    });

    return { step: "session", ...toSessionResponse(platformUser) };
  }
}

function isMfaCodeInvalid(error: unknown): boolean {
  return (
    error instanceof BadRequestException &&
    (error.getResponse() as { code?: string }).code === "MFA_CODE_INVALID"
  );
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
