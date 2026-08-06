import { randomBytes } from "node:crypto";

import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

import { TEXT_LIMITS, withinLimit } from "../../common/input-limits";
import { JsonLogger } from "../../common/json-logger.service";
import { normalizeEmail } from "../../common/normalize";
import { withSerializationRetry } from "../../common/prisma-retry";
import { RateLimiter } from "../../common/rate-limit";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { LoginBackoffService } from "../rate-limit/login-backoff.service";
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
  // Keying it on `request.ip` only means anything once Express is told to trust
  // the proxy in front of the API — see common/trust-proxy.ts.
  private readonly requestsByIp = new RateLimiter({
    limit: PASSWORD_RESET_IP_LIMIT,
    windowMs: PASSWORD_RESET_IP_WINDOW_MS,
  });

  // In-flight dispatches started by requestReset. Held only so tests (and a
  // graceful shutdown) can wait for them; nothing in the request path reads it.
  private readonly pendingDispatches = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly tenancyService: TenancyService,
    private readonly turnstileService: TurnstileService,
    private readonly loginBackoffService: LoginBackoffService,
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

    // Everything from here on runs *off* the response path, and that is the
    // point. Awaiting it would answer a known address only after a token write,
    // an HTTP round trip to the email provider and an audit insert, while an
    // unknown one returns straight after the lookup above — a difference of
    // hundreds of milliseconds, reliably measurable, which is the same account
    // enumeration the identical response bodies exist to prevent. Nothing the
    // caller is told depends on the outcome, so there is nothing to wait for.
    this.trackDispatch(
      this.issueAndSendResetToken({
        tenant,
        userId: user.id,
        email,
        requestId: request.requestId,
      }),
    );

    return acknowledge();
  }

  /**
   * Issue a token and mail it. Never rejects — it runs unawaited, so a thrown
   * error would surface as an unhandled rejection rather than anywhere useful.
   */
  private async issueAndSendResetToken(input: {
    tenant: {
      id: string;
      name: string;
      slug: string;
      language: string;
      timezone: string;
    };
    userId: string;
    email: string;
    requestId?: string;
  }): Promise<void> {
    const { tenant, userId, email, requestId } = input;

    try {
      const now = new Date();
      const token = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString(
        "base64url",
      );
      const expiresAt = new Date(
        now.getTime() + PASSWORD_RESET_TTL_MINUTES * MILLISECONDS_PER_MINUTE,
      );

      // Pruning, counting and issuing are one serializable unit: a plain
      // count-then-create lets two concurrent requests both read a count under
      // the ceiling and both write, putting the account over the limit the
      // count exists to enforce — the same re-check-inside-the-transaction
      // shape acceptInvite uses for the admin limit.
      const issued = await withSerializationRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            // Clearing this account's dead rows on every request is what bounds
            // the table without a cleanup worker, and it has to happen before
            // the count or spent tokens would count against the throttle.
            await tx.passwordResetToken.deleteMany({
              where: {
                tenantId: tenant.id,
                userId,
                OR: [{ usedAt: { not: null } }, { expiresAt: { lte: now } }],
              },
            });

            const activeTokenCount = await tx.passwordResetToken.count({
              where: { tenantId: tenant.id, userId },
            });

            if (activeTokenCount >= PASSWORD_RESET_MAX_ACTIVE_TOKENS) {
              return false;
            }

            await tx.passwordResetToken.create({
              data: {
                tenantId: tenant.id,
                userId,
                tokenHash: hashValue(token),
                expiresAt,
              },
            });

            return true;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );

      if (!issued) {
        this.logger.warn(
          {
            message: "password_reset_throttled",
            requestId,
            tenantSlug: tenant.slug,
          },
          "PasswordReset",
        );

        return;
      }

      const emailStatus = await this.emailService.sendPasswordResetEmail({
        to: email,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        language: tenant.language,
        timezone: tenant.timezone,
        token,
        expiresAt,
        requestId,
      });

      // Audited without the token: this records that a reset was asked for,
      // which is what an account owner reviewing their history needs to see.
      await this.recordEvent(tenant.id, userId, "password.reset_requested", {
        emailStatus,
      });
    } catch (error) {
      this.logger.error(
        {
          message: "password_reset_dispatch_failed",
          requestId,
          tenantSlug: tenant.slug,
          error: error instanceof Error ? error.message : String(error),
        },
        undefined,
        "PasswordReset",
      );
    }
  }

  private trackDispatch(dispatch: Promise<void>): void {
    this.pendingDispatches.add(dispatch);
    void dispatch.finally(() => this.pendingDispatches.delete(dispatch));
  }

  /**
   * Wait for the dispatches `requestReset` deliberately does not await. Exists
   * for tests, which would otherwise assert against work that has not run yet.
   */
  async settlePendingDispatches(): Promise<void> {
    while (this.pendingDispatches.size > 0) {
      await Promise.allSettled([...this.pendingDispatches]);
    }
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

    const now = new Date();

    // One transaction for the whole recovery, session revocation included.
    // Spending the token and setting the password have to be atomic — a
    // password changed against a token that stayed unspent would be reusable,
    // and a token spent without the password landing would strand the person
    // holding the only link they have. Revocation belongs in here for the same
    // reason: if it were a separate write and it failed, the password would
    // already be changed while whoever prompted the reset kept a live session,
    // which is precisely the guarantee this endpoint exists to give. Written
    // through `tx` rather than SessionService, which is not transaction-aware.
    //
    // Interactive rather than the array form it used to be, because the first
    // write has to be able to abort the rest: an array transaction makes its
    // contents atomic but claims nothing.
    await this.prisma.$transaction(async (tx) => {
      // Conditional on the token still being unspent. The `usedAt` check above
      // runs before this transaction opens — and `hashPassword` sits between
      // the two, so the window is argon2-wide, on the order of a hundred
      // milliseconds rather than microseconds. Two concurrent resets carrying
      // the same token both passed that check, both entered here and both
      // committed: under Read Committed the second UPDATE waits for the first
      // to release the row and then applies on top, so the account ended up
      // with whichever password committed last while both callers were told
      // they had succeeded. Claiming the row — and aborting when nothing was
      // claimed — makes exactly one of them the winner, the way
      // `auth.service.ts` does for invite acceptance and
      // `platform-mfa.service.ts` for a challenge token.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null },
        data: { usedAt: now },
      });

      if (claimed.count === 0) {
        throwInvalidResetToken();
      }

      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      // Every other token this account holds dies with the one just spent —
      // otherwise a second mail, sent before the first was used, still opens
      // the account after the owner has already recovered it.
      await tx.passwordResetToken.deleteMany({
        where: {
          tenantId: resetToken.tenantId,
          userId: user.id,
          id: { not: resetToken.id },
        },
      });
      await tx.session.updateMany({
        where: {
          tenantId: resetToken.tenantId,
          userId: user.id,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    });

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
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user || !user.passwordHash) {
      throwAuthenticationRequired();
    }

    // Same identity shape the tenant login uses — per tenant, so the same
    // address in two workspaces keeps separate counters — but its own scope, so
    // fumbling a password change never slows signing in, or the reverse.
    const backoffIdentity = `${session.tenantId}:${user.email}`;
    const currentPasswordMatches = await this.passwordService.verifyPassword(
      user.passwordHash,
      currentPassword,
    );

    // Re-checking the current password is what makes this safe to reach from an
    // unattended session: without it, a borrowed phone left signed in is enough
    // to take the account over.
    //
    // Which also makes it a credential endpoint, and the only one reachable
    // from a session someone else already has: whoever borrowed that phone can
    // guess the password here at whatever rate the per-IP cap allows. So a
    // wrong answer earns the same growing delay a wrong login does. A delay
    // rather than a refusal, for the reason in rate-limit.constants.ts — and
    // charged only on failure, so the account's owner never waits.
    if (!currentPasswordMatches) {
      await this.loginBackoffService.penalizeFailure(
        "password-change",
        backoffIdentity,
      );

      throw new BadRequestException({
        code: "CURRENT_PASSWORD_INVALID",
        message: "The current password is incorrect.",
        fieldErrors: {
          currentPassword: ["The current password is incorrect."],
        },
      });
    }

    await this.loginBackoffService.clearFailures(
      "password-change",
      backoffIdentity,
    );

    const passwordHash = await this.passwordService.hashPassword(newPassword);
    const now = new Date();

    // The new password, the sign-out of every device and the invalidation of
    // any outstanding reset link commit together or not at all. Split across
    // separate writes, a failure between them leaves the account in exactly the
    // state the change was meant to end: a new password with someone else's
    // session still live, or a reset link still able to undo it.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      this.prisma.session.updateMany({
        where: {
          tenantId: session.tenantId,
          userId: user.id,
          revokedAt: null,
        },
        data: { revokedAt: now },
      }),
      // Someone who changed their password deliberately has recovered the
      // account; a link still sitting in an inbox would undo that.
      this.prisma.passwordResetToken.deleteMany({
        where: { tenantId: session.tenantId, userId: user.id },
      }),
    ]);

    // Re-issued only after the revocation above is durable, so the caller's new
    // session can't be swept by it. Every other device stays signed out — that
    // is the point of changing a password — while the person who just did it
    // keeps the screen they did it on rather than being bounced to login. If
    // this call fails they are signed out too, which is the safe direction.
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

// The caps below are the same ones auth.service.ts applies to the identically
// named fields on login and invite acceptance. They belong here for the same
// reason they belong there — see common/input-limits.ts: `maxLength` in the
// browser is a courtesy to the person typing, and every one of these endpoints
// answers curl. An over-length value is rejected rather than truncated, which
// for these fields means "not a valid token / password / slug" and lands on the
// path each caller already has for that.

function normalizeTenantSlug(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedValue || !withinLimit(normalizedValue, "slug")) {
    return null;
  }

  return normalizedValue;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const token = value.trim();

  // A reset token is a fixed-size base64url string; anything longer is not one,
  // and hashing an unbounded value to look it up is wasted work.
  if (!token || !withinLimit(token, "token")) {
    return null;
  }

  return token;
}

function normalizeNewPassword(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length < MIN_PASSWORD_LENGTH ||
    value.length > TEXT_LIMITS.password
  ) {
    return null;
  }

  return value;
}

// No minimum: the stored password predates whatever the current one is, and the
// only question asked of it is whether it verifies. The maximum still applies —
// argon2 hashes whatever it is given, so an unbounded value is an unbounded
// amount of work per request. It locks nobody out either, since every path that
// *sets* a password caps it at the same length and login rejects anything
// longer outright.
function normalizeCurrentPassword(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (!value || !withinLimit(value, "password")) {
    return null;
  }

  return value;
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
