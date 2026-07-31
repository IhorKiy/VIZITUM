import { randomBytes } from "node:crypto";

import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

import { JsonLogger } from "../../common/json-logger.service";
import { normalizeEmail } from "../../common/normalize";
import { RateLimiter } from "../../common/rate-limit";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { hashValue } from "./auth-crypto";
import {
  CSRF_COOKIE_NAME,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RESET_IP_LIMIT,
  PASSWORD_RESET_IP_WINDOW_MS,
  PASSWORD_RESET_MAX_ACTIVE_TOKENS,
  PASSWORD_RESET_TOKEN_BYTES,
  PASSWORD_RESET_TTL_MINUTES,
} from "./auth.constants";
import { createCsrfToken, writeCsrfCookie } from "./csrf";
import type {
  ChangePasswordRequestBody,
  ForgotPasswordRequestBody,
  ResetPasswordRequestBody,
} from "./auth.types";
import { PasswordService } from "./password.service";
import { readSessionToken, writeSessionCookie } from "./session-cookie";
import { SessionService } from "./session.service";
import { TurnstileService } from "./turnstile.service";

const MILLISECONDS_PER_MINUTE = 60 * 1000;

export type PasswordResetAcknowledgement = { ok: true };

/**
 * Self-service password recovery and change.
 *
 * The invariant running through the whole request path is that
 * `POST /auth/password/forgot` must answer identically whether the address
 * belongs to an account or not. Tenant workspaces are addressable by slug and
 * their member lists are not public, so an endpoint that 404s on an unknown
 * address (or takes visibly longer on a known one) turns the login screen into
 * a membership oracle. Every early return below is therefore the same
 * acknowledgement, and the reasons are separated in the logs rather than in the
 * response.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new JsonLogger();

  // Instance state, so it lives as long as the Nest application context. See
  // RateLimiter's own note on why process-local is the right scope here.
  private readonly requestsByIp = new RateLimiter({
    limit: PASSWORD_RESET_IP_LIMIT,
    windowMs: PASSWORD_RESET_IP_WINDOW_MS,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly tenancyService: TenancyService,
    private readonly turnstileService: TurnstileService,
  ) {}

  async requestReset(
    body: ForgotPasswordRequestBody,
    request: Request,
  ): Promise<PasswordResetAcknowledgement> {
    // Captcha first, for the same reason login checks it first: keep scripted
    // traffic away from the work behind it.
    await this.turnstileService.assertValidToken(body.captchaToken);

    const email = normalizeEmail(body.email);
    const tenantSlug = normalizeTenantSlug(body.tenantSlug);

    if (!this.requestsByIp.consume(request.ip ?? "unknown")) {
      this.logger.warn(
        {
          message: "password_reset_rate_limited",
          requestId: request.requestId,
          tenantSlug,
        },
        "PasswordReset",
      );

      return acknowledge();
    }

    if (!email) {
      return acknowledge();
    }

    const tenant = await this.resolveTenant(tenantSlug, request);

    if (!tenant) {
      return acknowledge();
    }

    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      select: { id: true, status: true, deletedAt: true },
    });

    // Only an active account can be reset into. An `invited` user has no
    // password yet and still holds a valid invite; a suspended or deleted one
    // must not be handed a way back in.
    if (!user || user.status !== "active" || user.deletedAt) {
      return acknowledge();
    }

    const now = new Date();

    // Clearing this account's dead rows on every request is what bounds the
    // table without a cleanup worker, and it has to happen before the live
    // count below or spent tokens would count against the throttle.
    await this.prisma.passwordResetToken.deleteMany({
      where: {
        tenantId: tenant.id,
        userId: user.id,
        OR: [{ usedAt: { not: null } }, { expiresAt: { lte: now } }],
      },
    });

    const activeTokenCount = await this.prisma.passwordResetToken.count({
      where: { tenantId: tenant.id, userId: user.id },
    });

    if (activeTokenCount >= PASSWORD_RESET_MAX_ACTIVE_TOKENS) {
      this.logger.warn(
        {
          message: "password_reset_throttled",
          requestId: request.requestId,
          tenantSlug: tenant.slug,
        },
        "PasswordReset",
      );

      return acknowledge();
    }

    const token = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(
      now.getTime() + PASSWORD_RESET_TTL_MINUTES * MILLISECONDS_PER_MINUTE,
    );

    await this.prisma.passwordResetToken.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        tokenHash: hashValue(token),
        expiresAt,
      },
    });

    const emailStatus = await this.emailService.sendPasswordResetEmail({
      to: email,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      language: tenant.language,
      timezone: tenant.timezone,
      token,
      expiresAt,
      requestId: request.requestId,
    });

    // Audited without the token: this records that a reset was asked for, which
    // is what an account owner reviewing their history needs to see.
    await this.recordEvent(tenant.id, user.id, "password.reset_requested", {
      emailStatus,
    });

    return acknowledge();
  }

  async resetPassword(
    body: ResetPasswordRequestBody,
    request: Request,
  ): Promise<PasswordResetAcknowledgement> {
    const token = normalizeToken(body.token);
    const password = normalizeNewPassword(body.password);
    const tenantSlug = normalizeTenantSlug(body.tenantSlug);

    if (!token || !password) {
      throw new BadRequestException({
        code: "PASSWORD_RESET_INVALID",
        message: "A reset token and a new password are required.",
        fieldErrors: {
          token: token ? [] : ["Reset token is required."],
          password: password
            ? []
            : [`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`],
        },
      });
    }

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashValue(token) },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt <= new Date()
    ) {
      throwInvalidResetToken();
    }

    // Same check the invite flow makes: when the screen states which workspace
    // it is resetting into, that claim has to match the token's own tenant.
    if (tenantSlug) {
      const tenant = await this.prisma.platformTenant.findUnique({
        where: { slug: tenantSlug },
        select: { id: true },
      });

      if (!tenant || tenant.id !== resetToken.tenantId) {
        throwInvalidResetToken();
      }
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: resetToken.userId,
        tenantId: resetToken.tenantId,
        status: "active",
        deletedAt: null,
      },
      select: { id: true },
    });

    // The account can have been suspended or deleted in the hour since the mail
    // went out; a token outliving that would be a way back into a closed
    // account.
    if (!user) {
      throwInvalidResetToken();
    }

    const passwordHash = await this.passwordService.hashPassword(password);

    // Spending the token and setting the password in one transaction: a
    // password changed against a token that stayed unspent would be reusable,
    // and a token spent without the password landing would strand the person
    // holding the only link they have.
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      // Every other token this account holds dies with the one just spent —
      // otherwise a second mail, sent before the first was used, still opens
      // the account after the owner has already recovered it.
      this.prisma.passwordResetToken.deleteMany({
        where: {
          tenantId: resetToken.tenantId,
          userId: user.id,
          id: { not: resetToken.id },
        },
      }),
    ]);

    // Whoever prompted the reset may already be holding a session on this
    // account. Recovering the password has to end those, and the person
    // resetting signs in fresh with the password they just chose.
    await this.sessionService.revokeUserSessions(resetToken.tenantId, user.id);

    await this.recordEvent(
      resetToken.tenantId,
      user.id,
      "password.reset_completed",
      { requestId: request.requestId },
    );

    return acknowledge();
  }

  async changePassword(
    body: ChangePasswordRequestBody,
    request: Request,
    response: Response,
  ): Promise<PasswordResetAcknowledgement> {
    const sessionToken = readSessionToken(request);

    if (!sessionToken) {
      throwAuthenticationRequired();
    }

    const session =
      await this.sessionService.findActiveSessionByToken(sessionToken);

    if (!session) {
      throwAuthenticationRequired();
    }

    const currentPassword = normalizeCurrentPassword(body.currentPassword);
    const newPassword = normalizeNewPassword(body.newPassword);

    if (!currentPassword || !newPassword) {
      throw new BadRequestException({
        code: "PASSWORD_CHANGE_INVALID",
        message: "The current and a new password are required.",
        fieldErrors: {
          currentPassword: currentPassword
            ? []
            : ["Current password is required."],
          newPassword: newPassword
            ? []
            : [`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`],
        },
      });
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: session.userId,
        tenantId: session.tenantId,
        status: "active",
        deletedAt: null,
      },
      select: { id: true, passwordHash: true },
    });

    if (!user || !user.passwordHash) {
      throwAuthenticationRequired();
    }

    const currentPasswordMatches = await this.passwordService.verifyPassword(
      user.passwordHash,
      currentPassword,
    );

    // Re-checking the current password is what makes this safe to reach from an
    // unattended session: without it, a borrowed phone left signed in is enough
    // to take the account over.
    if (!currentPasswordMatches) {
      throw new BadRequestException({
        code: "CURRENT_PASSWORD_INVALID",
        message: "The current password is incorrect.",
        fieldErrors: {
          currentPassword: ["The current password is incorrect."],
        },
      });
    }

    const passwordHash = await this.passwordService.hashPassword(newPassword);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Revoke everywhere, then re-issue for the caller. Every other device is
    // signed out — that is the point of changing a password — while the person
    // who just did it keeps the screen they did it on rather than being bounced
    // to login. The new cookies replace the ones whose session was just killed.
    await this.sessionService.revokeUserSessions(session.tenantId, user.id);

    const { token: freshSessionToken } =
      await this.sessionService.createSession({
        tenantId: session.tenantId,
        userId: user.id,
        userAgent: request.header("user-agent"),
        ipAddress: request.ip,
      });

    writeSessionCookie(response, freshSessionToken);
    writeCsrfCookie(
      response,
      createCsrfToken(freshSessionToken),
      CSRF_COOKIE_NAME,
    );

    // Any pending reset links are dead too: someone who changed their password
    // deliberately has recovered the account, and a link still sitting in an
    // inbox would undo that.
    await this.prisma.passwordResetToken.deleteMany({
      where: { tenantId: session.tenantId, userId: user.id },
    });

    await this.recordEvent(session.tenantId, user.id, "password.changed", {
      requestId: request.requestId,
    });

    return acknowledge();
  }

  /**
   * The tenant the request is about. An explicit slug from the form wins, and
   * the host/path fallback matches how login resolves it, so a workspace on its
   * own domain works without the form carrying a slug.
   */
  private async resolveTenant(tenantSlug: string | null, request: Request) {
    try {
      const { tenant } = await this.tenancyService.resolveTenant({
        host: request.header("host"),
        path: tenantSlug ?? request.path,
      });

      return tenant;
    } catch {
      // resolveTenant throws for an unknown slug and for a tenant not currently
      // serving requests. Both are swallowed here: an unresolvable tenant is one
      // more thing the response must not distinguish from a resolvable one with
      // no such member.
      return null;
    }
  }

  private async recordEvent(
    tenantId: string,
    userId: string,
    eventType: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    // Written straight through Prisma rather than AuditService: these events
    // have no RequestContext behind them (forgot-password is unauthenticated,
    // and the actor is the account itself in all three cases).
    await this.prisma.auditEvent.create({
      data: {
        tenantId,
        actorUserId: userId,
        entityType: "user",
        entityId: userId,
        eventType,
        metadata,
      },
    });
  }
}

function acknowledge(): PasswordResetAcknowledgement {
  return { ok: true };
}

function normalizeTenantSlug(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  return normalizedValue || null;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const token = value.trim();

  return token || null;
}

function normalizeNewPassword(value: unknown): string | null {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH) {
    return null;
  }

  return value;
}

// Not length-checked: the stored password predates whatever the current minimum
// is, and the only question asked of it is whether it verifies.
function normalizeCurrentPassword(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value || null;
}

function throwInvalidResetToken(): never {
  throw new BadRequestException({
    code: "PASSWORD_RESET_INVALID",
    message: "Reset link is invalid or expired.",
  });
}

function throwAuthenticationRequired(): never {
  throw new UnauthorizedException({
    code: "AUTHENTICATION_REQUIRED",
    message: "Authentication is required.",
  });
}
