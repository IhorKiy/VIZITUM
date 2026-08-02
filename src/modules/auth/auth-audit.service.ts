import { Injectable } from "@nestjs/common";

import { JsonLogger } from "../../common/json-logger.service";
import { SentryService } from "../../common/sentry.service";
import { PrismaService } from "../prisma/prisma.service";

// Sign-in events for both domains. Tenant events land in `AuditEvent`
// (tenant-scoped, next to the account lifecycle they belong with); platform
// events land in `PlatformOperationEvent`, since a platform owner is not a
// tenant user and has no tenant to scope to.
//
// The naming follows the rest of the trail (`password.reset_requested`,
// `tenant.archived`): domain, then what happened, in the past tense.
export const AUTH_AUDIT_EVENTS = {
  tenantLoginSucceeded: "auth.login_succeeded",
  tenantLoginFailed: "auth.login_failed",
  tenantLoggedOut: "auth.logged_out",
  platformLoginSucceeded: "platform.login_succeeded",
  platformLoginFailed: "platform.login_failed",
  platformLoggedOut: "platform.logged_out",
  // Re-authentication refused at a destructive endpoint. Its own event rather
  // than a login failure: somebody presenting codes here already holds a
  // session, which is a different story from somebody guessing at the login
  // page, and it is the story an alert wants to separate.
  platformReauthFailed: "platform.reauth_failed",
} as const;

// Why a sign-in was refused. Recorded because the trail exists to answer
// "what was this traffic doing", and a run of `unknown_account` across many
// addresses is a different event from a run of `wrong_password` against one.
// It is safe to be this specific: nothing reads these rows back over the API,
// so the distinction the login response deliberately withholds is not
// reintroduced anywhere a guesser can see it.
export type AuthFailureReason =
  | "unknown_account"
  | "inactive_account"
  | "wrong_password"
  | "wrong_code"
  // The half-authenticated state between the password step and the code step
  // was refused: expired, already spent, or claimed for the other step. Worth
  // its own reason rather than folding into `wrong_code`, because a run of
  // these is somebody replaying captured challenge tokens, which is a
  // different story from somebody guessing six digits.
  | "invalid_challenge";

// How the second factor was satisfied. A recovery code is worth telling apart
// from an authenticator: spending one usually means the owner lost their
// device, and the remaining codes are now fewer.
export type PlatformLoginMethod = "totp" | "recovery_code" | "enrollment";

export type TenantLoginAuditInput = {
  tenantId: string;
  // Null when the address matched no account — the case the trail most needs
  // to keep, since that is what credential stuffing looks like.
  userId: string | null;
  email: string;
  requestId?: string;
  reason?: AuthFailureReason;
};

export type PlatformLoginAuditInput = {
  platformUserId: string | null;
  // Absent when the attempt was refused before any account was resolved — a
  // rejected challenge token carries no identity of its own.
  email?: string;
  requestId?: string;
  reason?: AuthFailureReason;
  method?: PlatformLoginMethod;
};

@Injectable()
export class AuthAuditService {
  private readonly logger = new JsonLogger();
  // Constructed rather than injected, the way `src/worker.ts` does it and for
  // the same reason: this service is built by hand in tests, and a Sentry
  // with no DSN configured is a no-op, so nothing has to be stubbed.
  private readonly sentry = new SentryService();

  constructor(private readonly prisma: PrismaService) {}

  async recordTenantLoginSucceeded(
    input: TenantLoginAuditInput,
  ): Promise<void> {
    await this.writeTenantEvent({
      eventType: AUTH_AUDIT_EVENTS.tenantLoginSucceeded,
      tenantId: input.tenantId,
      userId: input.userId,
      requestId: input.requestId,
      metadata: buildMetadata(input),
    });
  }

  async recordTenantLoginFailed(input: TenantLoginAuditInput): Promise<void> {
    await this.writeTenantEvent({
      eventType: AUTH_AUDIT_EVENTS.tenantLoginFailed,
      tenantId: input.tenantId,
      userId: input.userId,
      requestId: input.requestId,
      metadata: buildMetadata(input),
    });
  }

  async recordTenantLoggedOut(input: {
    tenantId: string;
    userId: string;
    requestId?: string;
  }): Promise<void> {
    await this.writeTenantEvent({
      eventType: AUTH_AUDIT_EVENTS.tenantLoggedOut,
      tenantId: input.tenantId,
      userId: input.userId,
      requestId: input.requestId,
      metadata: {},
    });
  }

  async recordPlatformLoginSucceeded(
    input: PlatformLoginAuditInput,
  ): Promise<void> {
    await this.writePlatformEvent({
      eventType: AUTH_AUDIT_EVENTS.platformLoginSucceeded,
      platformUserId: input.platformUserId,
      requestId: input.requestId,
      metadata: buildMetadata(input),
    });
  }

  async recordPlatformLoginFailed(
    input: PlatformLoginAuditInput,
  ): Promise<void> {
    await this.writePlatformEvent({
      eventType: AUTH_AUDIT_EVENTS.platformLoginFailed,
      platformUserId: input.platformUserId,
      requestId: input.requestId,
      metadata: buildMetadata(input),
    });
  }

  /**
   * A code refused in front of a destructive action.
   *
   * Carries the tenant, unlike the sign-in events: what was being attempted
   * is the whole point of the record.
   */
  async recordPlatformReauthFailed(input: {
    platformUserId: string;
    email?: string;
    tenantId: string;
    requestId?: string;
  }): Promise<void> {
    await this.writePlatformEvent({
      eventType: AUTH_AUDIT_EVENTS.platformReauthFailed,
      platformUserId: input.platformUserId,
      tenantId: input.tenantId,
      requestId: input.requestId,
      metadata: buildMetadata({
        email: input.email,
        reason: "wrong_code",
      }),
    });
  }

  async recordPlatformLoggedOut(input: {
    platformUserId: string;
    requestId?: string;
  }): Promise<void> {
    await this.writePlatformEvent({
      eventType: AUTH_AUDIT_EVENTS.platformLoggedOut,
      platformUserId: input.platformUserId,
      requestId: input.requestId,
      metadata: {},
    });
  }

  private async writeTenantEvent(event: {
    eventType: string;
    tenantId: string;
    userId: string | null;
    requestId?: string;
    metadata: Record<string, string>;
  }): Promise<void> {
    await this.write(event.eventType, () =>
      this.prisma.auditEvent.create({
        data: {
          tenantId: event.tenantId,
          actorUserId: event.userId,
          entityType: "user",
          // An attempt against an address that matches no account has no id to
          // point at; the address itself is in the metadata.
          entityId: event.userId ?? "unknown",
          eventType: event.eventType,
          metadata: event.metadata,
          requestId: event.requestId,
        },
      }),
    );
  }

  private async writePlatformEvent(event: {
    eventType: string;
    platformUserId: string | null;
    tenantId?: string;
    requestId?: string;
    metadata: Record<string, string>;
  }): Promise<void> {
    await this.write(event.eventType, () =>
      this.prisma.platformOperationEvent.create({
        data: {
          // Sign-in events name no tenant — a platform owner reaches all of
          // them. A refused re-auth does, because which tenant was being acted
          // on is the point of the record.
          tenantId: event.tenantId ?? null,
          actorUserId: event.platformUserId,
          eventType: event.eventType,
          metadata: event.metadata,
          requestId: event.requestId,
        },
      }),
    );
  }

  // Auditing is best-effort on purpose. A failed write is reported rather than
  // thrown: refusing to sign anyone in because the audit table is unavailable
  // turns a degraded trail into an outage, and the same failure on the
  // *failed*-login path would answer a wrong password with a 500.
  //
  // Reported to Sentry as well as logged, because a swallowed failure is the
  // one thing nobody would notice: the symptom of a broken trail is an empty
  // trail, which looks exactly like a quiet week. Sentry is where the alert
  // rows in docs/runbooks/production-alerts.md already live.
  //
  // Deliberately *not* a counter on the operations summary: every counter
  // there is a `count()` over rows with a failed status, and a write that
  // never reached the database leaves no row to count.
  private async write(
    eventType: string,
    create: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await create();
    } catch (error) {
      this.logger.error(
        {
          message: "auth_audit_write_failed",
          eventType,
          error: error instanceof Error ? error.message : String(error),
        },
        undefined,
        "AuthAudit",
      );

      void this.sentry.captureException({
        exception: error,
        requestId: "auth-audit",
        module: "AuthAudit",
        operation: eventType,
        errorCode: "AUTH_AUDIT_WRITE_FAILED",
      });
    }
  }
}

function buildMetadata(input: {
  email?: string;
  reason?: AuthFailureReason;
  method?: PlatformLoginMethod;
}): Record<string, string> {
  return {
    // The address the attempt was made against, so the trail reads without a
    // join to a user row that may not exist.
    ...(input.email ? { email: input.email } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.method ? { method: input.method } : {}),
  };
}
