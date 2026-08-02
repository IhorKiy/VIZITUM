import { Injectable } from "@nestjs/common";

import { JsonLogger } from "../../common/json-logger.service";
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
} as const;

// Why a sign-in was refused. Recorded because the trail exists to answer
// "what was this traffic doing", and a run of `unknown_account` across many
// addresses is a different event from a run of `wrong_password` against one.
// It is safe to be this specific: nothing reads these rows back over the API,
// so the distinction the login response deliberately withholds is not
// reintroduced anywhere a guesser can see it.
export type AuthFailureReason =
  "unknown_account" | "inactive_account" | "wrong_password" | "wrong_code";

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
  email: string;
  requestId?: string;
  reason?: AuthFailureReason;
  method?: PlatformLoginMethod;
};

@Injectable()
export class AuthAuditService {
  private readonly logger = new JsonLogger();

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
    requestId?: string;
    metadata: Record<string, string>;
  }): Promise<void> {
    await this.write(event.eventType, () =>
      this.prisma.platformOperationEvent.create({
        data: {
          // Not about any one tenant — a platform owner reaches all of them.
          tenantId: null,
          actorUserId: event.platformUserId,
          eventType: event.eventType,
          metadata: event.metadata,
          requestId: event.requestId,
        },
      }),
    );
  }

  // Auditing is best-effort on purpose. A failed write is logged as an error
  // rather than thrown: refusing to sign anyone in because the audit table is
  // unavailable turns a degraded trail into an outage, and the same failure on
  // the *failed*-login path would answer a wrong password with a 500. The
  // error log is what keeps a silently empty trail noticeable.
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
    }
  }
}

function buildMetadata(input: {
  email: string;
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
