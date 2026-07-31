import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

import { TEXT_LIMITS, withinLimit } from "../../common/input-limits";
import { normalizeEmail } from "../../common/normalize";
import {
  buildUserNameFields,
  normalizeNamePart,
} from "../../common/person-name";
import { normalizePhoneInput } from "../../common/phone";
import { withSerializationRetry } from "../../common/prisma-retry";
import { PrismaService } from "../prisma/prisma.service";
import { LoginBackoffService } from "../rate-limit/login-backoff.service";
import { RolesService } from "../roles/roles.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { hashValue } from "./auth-crypto";
import { PasswordService } from "./password.service";
import { CSRF_COOKIE_NAME, MIN_PASSWORD_LENGTH } from "./auth.constants";
import { createCsrfToken, writeCsrfCookie } from "./csrf";
import { readSessionToken, writeSessionCookie } from "./session-cookie";
import { SessionService } from "./session.service";
import { TurnstileService } from "./turnstile.service";
import type {
  AcceptInviteRequestBody,
  LoginRequestBody,
  LoginResponse,
  SwitchRoleRequestBody,
  SwitchZoneRequestBody,
} from "./auth.types";
import { isValidZone, isZoneAvailable } from "./zones";
import { locationCategoriesEnabledFromSetting } from "../settings/location-categories-enabled";
import { productsEnabledFromSetting } from "../settings/products-enabled";
import {
  LOCATION_CATEGORIES_ENABLED_SETTING_KEY,
  PRODUCTS_ENABLED_SETTING_KEY,
} from "../settings/settings.types";
import { DEFAULT_ADMIN_LIMIT, resolveAdminCap } from "../users/users.types";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly rolesService: RolesService,
    private readonly sessionService: SessionService,
    private readonly tenancyService: TenancyService,
    private readonly turnstileService: TurnstileService,
    private readonly loginBackoffService: LoginBackoffService,
  ) {}

  async login(
    body: LoginRequestBody,
    request: Request,
    response: Response,
  ): Promise<LoginResponse> {
    const email = normalizeEmail(body.email);
    const password = normalizePassword(body.password);

    if (!email || !password) {
      throwInvalidCredentials();
    }

    // Captcha comes before any database work: the point is to keep
    // credential-stuffing traffic away from the password verifier entirely.
    await this.turnstileService.assertValidToken(body.captchaToken);

    const tenantSlug = normalizeTenantSlug(body.tenantSlug);
    const { tenant } = await this.tenancyService.resolveTenant({
      host: request.header("host"),
      path: tenantSlug ?? request.path,
    });

    const user = await this.prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email,
        },
      },
      include: {
        roles: true,
      },
    });

    // Keyed per tenant so the same address in two tenants keeps separate
    // counters, and applied whether or not the user exists so a missing
    // account and a wrong password behave identically here.
    const backoffIdentity = `${tenant.id}:${email}`;

    if (!user || user.status !== "active" || !user.passwordHash) {
      await this.loginBackoffService.penalizeFailure(
        "tenant-login",
        backoffIdentity,
      );
      throwInvalidCredentials();
    }

    const passwordMatches = await this.passwordService.verifyPassword(
      user.passwordHash,
      password,
    );

    if (!passwordMatches) {
      await this.loginBackoffService.penalizeFailure(
        "tenant-login",
        backoffIdentity,
      );
      throwInvalidCredentials();
    }

    // Correct credentials clear the debt: the delay only ever slows guessing,
    // it never carries over to the person who actually owns the account.
    await this.loginBackoffService.clearFailures(
      "tenant-login",
      backoffIdentity,
    );

    const { token } = await this.sessionService.createSession({
      tenantId: tenant.id,
      userId: user.id,
      userAgent: request.header("user-agent"),
      ipAddress: request.ip,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    writeSessionCookie(response, token);
    writeCsrfCookie(response, createCsrfToken(token), CSRF_COOKIE_NAME);

    const roleCodes = user.roles.map((role) => role.roleCode);
    const permissions = this.rolesService.getPermissionsForRoles(roleCodes);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        status: user.status,
        lastSelectedRoleCode: user.lastSelectedRoleCode,
        lastSelectedZone: user.lastSelectedZone,
      },
      roleCodes,
      permissions,
    };
  }

  async acceptInvite(
    body: AcceptInviteRequestBody,
    request: Request,
    response: Response,
  ): Promise<LoginResponse> {
    const token = normalizeToken(body.token);
    const tenantSlug = normalizeTenantSlug(body.tenantSlug);
    const firstName = normalizeNamePart(body.firstName);
    const lastName = normalizeNamePart(body.lastName);
    const password = normalizeNewPassword(body.password);

    if (!token || !firstName || !lastName || !password) {
      throw new BadRequestException({
        code: "INVITE_ACCEPTANCE_INVALID",
        message:
          "Invite token, first name, last name and password are required.",
        fieldErrors: {
          token: token ? [] : ["Invite token is required."],
          firstName: firstName ? [] : ["First name is required."],
          lastName: lastName ? [] : ["Last name is required."],
          password: password ? [] : ["Password must be at least 8 characters."],
        },
      });
    }

    const nameFields = buildUserNameFields({ firstName, lastName });

    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: hashValue(token) },
    });

    if (!invite || invite.status !== "pending") {
      throwInvalidInvite();
    }

    if (tenantSlug) {
      const tenant = await this.prisma.platformTenant.findUnique({
        where: { slug: tenantSlug },
        select: { id: true },
      });

      if (!tenant || tenant.id !== invite.tenantId) {
        throwInvalidInvite();
      }
    }

    if (invite.expiresAt <= new Date()) {
      await this.prisma.invite.update({
        where: { id: invite.id },
        data: { status: "expired" },
      });
      throwInvalidInvite();
    }

    // The phone parses against the invite tenant's phoneCountry, so this can
    // only run once the token has resolved to a tenant.
    const inviteTenant = await this.prisma.platformTenant.findUniqueOrThrow({
      where: { id: invite.tenantId },
      select: { phoneCountry: true },
    });
    const normalizedPhone = normalizePhoneInput(
      body.phone,
      inviteTenant.phoneCountry,
    );

    if (!normalizedPhone.ok) {
      throw new BadRequestException({
        code: "INVITE_ACCEPTANCE_INVALID",
        message: "Phone number is invalid.",
        fieldErrors: {
          phone: [
            normalizedPhone.reason === "country_required"
              ? "Enter the phone in international format (+...)."
              : "Enter a valid phone number.",
          ],
        },
      });
    }

    const phone = normalizedPhone.e164;
    const passwordHash = await this.passwordService.hashPassword(password);

    const result = await withSerializationRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          // Invite-time already checked the admin limit against the count of
          // *active* admins, which doesn't account for other pending invites
          // sent before any of them were accepted. Re-check here so a burst of
          // invites can't collectively push the tenant past its admin limit
          // once they're all accepted.
          if (invite.roleCodes.includes("company_admin")) {
            const tenant = await tx.platformTenant.findUnique({
              where: { id: invite.tenantId },
              select: { adminLimit: true, status: true },
            });
            const adminLimit = tenant
              ? resolveAdminCap(tenant)
              : DEFAULT_ADMIN_LIMIT;
            const activeAdminCount = await tx.user.count({
              where: {
                tenantId: invite.tenantId,
                status: "active",
                deletedAt: null,
                roles: {
                  some: {
                    tenantId: invite.tenantId,
                    roleCode: "company_admin",
                  },
                },
              },
            });

            if (activeAdminCount >= adminLimit) {
              throw new ConflictException({
                code: "TENANT_ADMIN_LIMIT",
                message: `This tenant is limited to ${adminLimit} active Company Admin(s).`,
              });
            }
          }

          // An invite is a password-setting credential for its email address,
          // and it stays valid for its full 7-day TTL. Both issue paths
          // refuse an address that already belongs to a live user, but
          // nothing stopped an invite issued *before* that account existed —
          // or before a deleted one was restored — from being redeemed
          // afterwards, and the upsert below would then overwrite the live
          // account's password and reactivate it.
          //
          // Checked on `deletedAt` as well as status because reactivating a
          // soft-deleted user through a fresh invite is a supported flow; a
          // deleted row carries status "deleted", so only a genuinely live
          // account is refused here.
          const existingUser = await tx.user.findUnique({
            where: {
              tenantId_email: {
                tenantId: invite.tenantId,
                email: invite.email,
              },
            },
            select: { status: true, deletedAt: true },
          });

          if (
            existingUser &&
            existingUser.status === "active" &&
            !existingUser.deletedAt
          ) {
            throw new ConflictException({
              code: "INVITE_ACCOUNT_ALREADY_ACTIVE",
              message:
                "This account is already active. Sign in with your password instead of using the invite link.",
            });
          }

          const acceptedUser = await tx.user.upsert({
            where: {
              tenantId_email: {
                tenantId: invite.tenantId,
                email: invite.email,
              },
            },
            create: {
              tenantId: invite.tenantId,
              email: invite.email,
              ...nameFields,
              phone,
              passwordHash,
              status: "active",
              lastSelectedRoleCode: invite.roleCodes[0] ?? null,
            },
            update: {
              ...nameFields,
              phone,
              passwordHash,
              status: "active",
              lastSelectedRoleCode: invite.roleCodes[0] ?? null,
              deletedAt: null,
            },
          });

          for (const roleCode of invite.roleCodes) {
            await tx.userRole.upsert({
              where: {
                tenantId_userId_roleCode: {
                  tenantId: invite.tenantId,
                  userId: acceptedUser.id,
                  roleCode,
                },
              },
              create: {
                tenantId: invite.tenantId,
                userId: acceptedUser.id,
                roleCode,
                assignedByUserId: invite.createdByUserId,
              },
              update: {},
            });
          }

          // Superadmin replacement: at most one active superadmin at a time.
          // The previously active superadmin (if any) stays active right up
          // until this moment — see PlatformService.inviteOrReplaceTenantSuperadmin
          // — and is demoted here, atomically with the new one taking over.
          // Demotion swaps their role to company_admin (suspended) rather than
          // leaving them stuck holding tenant_superadmin: assertTargetNotSuperadmin
          // blocks every tenant-side action against a superadmin-role user
          // unconditionally, and the platform owner has no endpoint to touch an
          // inactive superadmin either, so leaving the role in place would make
          // that account permanently unreachable — no way to reactivate or
          // delete a "temporarily replaced" superadmin. As a suspended
          // company_admin, the new superadmin can manage them through the
          // ordinary admin lifecycle. Written via `tx` directly (not
          // AuditService, which isn't transaction-aware) so it commits or rolls
          // back with the acceptance.
          const demotedSuperadminIds: string[] = [];

          if (invite.roleCodes.includes("tenant_superadmin")) {
            const previousSuperadmins = await tx.user.findMany({
              where: {
                tenantId: invite.tenantId,
                id: { not: acceptedUser.id },
                status: "active",
                deletedAt: null,
                roles: {
                  some: {
                    tenantId: invite.tenantId,
                    roleCode: "tenant_superadmin",
                  },
                },
              },
              select: { id: true },
            });

            for (const previousSuperadmin of previousSuperadmins) {
              demotedSuperadminIds.push(previousSuperadmin.id);

              await tx.user.update({
                where: { id: previousSuperadmin.id },
                data: {
                  status: "suspended",
                  lastSelectedRoleCode: "company_admin",
                },
              });

              await tx.userRole.deleteMany({
                where: {
                  tenantId: invite.tenantId,
                  userId: previousSuperadmin.id,
                  roleCode: "tenant_superadmin",
                },
              });

              await tx.userRole.upsert({
                where: {
                  tenantId_userId_roleCode: {
                    tenantId: invite.tenantId,
                    userId: previousSuperadmin.id,
                    roleCode: "company_admin",
                  },
                },
                create: {
                  tenantId: invite.tenantId,
                  userId: previousSuperadmin.id,
                  roleCode: "company_admin",
                  assignedByUserId: null,
                },
                update: {},
              });

              await tx.auditEvent.create({
                data: {
                  tenantId: invite.tenantId,
                  actorUserId: null,
                  entityType: "user",
                  entityId: previousSuperadmin.id,
                  eventType: "superadmin.replaced",
                  metadata: { newSuperadminUserId: acceptedUser.id },
                },
              });
            }
          }

          // Conditional on the invite still being pending, inside the
          // transaction. The `status !== "pending"` check above runs before
          // the transaction opens, so on its own it leaves a window where two
          // concurrent acceptances of the same token both pass it. Claiming
          // the row here — and aborting when nothing was claimed — means
          // exactly one of them commits.
          const claimed = await tx.invite.updateMany({
            where: { id: invite.id, status: "pending" },
            data: {
              status: "accepted",
              acceptedAt: new Date(),
              acceptedByUserId: acceptedUser.id,
            },
          });

          if (claimed.count === 0) {
            throwInvalidInvite();
          }

          return { acceptedUser, demotedSuperadminIds };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
    const { acceptedUser: user, demotedSuperadminIds } = result;

    // Revoked after commit, not inside the transaction: SessionService
    // writes through `this.prisma`, not `tx`, so it can't participate in the
    // transaction's atomicity anyway, and revoking only once the demotion is
    // durably committed avoids revoking a session for a demotion that then
    // rolls back.
    for (const demotedSuperadminId of demotedSuperadminIds) {
      await this.sessionService.revokeUserSessions(
        invite.tenantId,
        demotedSuperadminId,
      );
    }

    const { token: sessionToken } = await this.sessionService.createSession({
      tenantId: invite.tenantId,
      userId: user.id,
      userAgent: request.header("user-agent"),
      ipAddress: request.ip,
    });

    writeSessionCookie(response, sessionToken);
    writeCsrfCookie(response, createCsrfToken(sessionToken), CSRF_COOKIE_NAME);

    const roleCodes = invite.roleCodes;

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        status: user.status,
        lastSelectedRoleCode: user.lastSelectedRoleCode,
        lastSelectedZone: user.lastSelectedZone,
      },
      roleCodes,
      permissions: this.rolesService.getPermissionsForRoles(roleCodes),
    };
  }

  async getCurrentUser(request: Request): Promise<
    LoginResponse & {
      productsEnabled: boolean;
      locationCategoriesEnabled: boolean;
      tenantTimezone: string;
      // Tenant is still on the pilot plan tier (status "pilot"). Drives the
      // temporary "Pilot" admin nav area, which disappears once the owner
      // graduates the tenant to team/business.
      pilotActive: boolean;
    }
  > {
    const token = readSessionToken(request);

    if (!token) {
      throwAuthenticationRequired();
    }

    const session = await this.sessionService.findActiveSessionByToken(token);

    if (!session) {
      throwAuthenticationRequired();
    }

    const [user, tenantSettings, tenant] = await Promise.all([
      this.prisma.user.findFirst({
        where: {
          id: session.userId,
          tenantId: session.tenantId,
        },
        include: { roles: true },
      }),
      // `/auth/me` is a hot path, so the two toggle lookups are one query
      // (same unique index, `tenantId_key`, backs both) instead of two.
      this.prisma.tenantSetting.findMany({
        where: {
          tenantId: session.tenantId,
          key: {
            in: [
              PRODUCTS_ENABLED_SETTING_KEY,
              LOCATION_CATEGORIES_ENABLED_SETTING_KEY,
            ],
          },
        },
        select: { key: true, value: true },
      }),
      this.prisma.platformTenant.findUnique({
        where: { id: session.tenantId },
        select: { timezone: true, status: true },
      }),
    ]);

    if (!user || user.status !== "active") {
      throwAuthenticationRequired();
    }

    const roleCodes = user.roles.map((role) => role.roleCode);
    const productsEnabledSetting = tenantSettings.find(
      (setting) => setting.key === PRODUCTS_ENABLED_SETTING_KEY,
    );
    const locationCategoriesEnabledSetting = tenantSettings.find(
      (setting) => setting.key === LOCATION_CATEGORIES_ENABLED_SETTING_KEY,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        status: user.status,
        lastSelectedRoleCode: user.lastSelectedRoleCode,
        lastSelectedZone: user.lastSelectedZone,
      },
      roleCodes,
      permissions: this.rolesService.getPermissionsForRoles(roleCodes),
      productsEnabled: productsEnabledFromSetting(productsEnabledSetting),
      locationCategoriesEnabled: locationCategoriesEnabledFromSetting(
        locationCategoriesEnabledSetting,
      ),
      tenantTimezone: tenant?.timezone ?? "UTC",
      pilotActive: tenant?.status === "pilot",
    };
  }

  async switchRole(
    body: SwitchRoleRequestBody,
    request: Request,
    response: Response,
  ): Promise<LoginResponse> {
    const selectedRoleCode = normalizeRoleCode(body.roleCode);

    if (!selectedRoleCode) {
      throw new BadRequestException({
        code: "INVALID_ROLE",
        message: "A valid role code is required.",
      });
    }

    const token = readSessionToken(request);

    if (!token) {
      throwAuthenticationRequired();
    }

    const session = await this.sessionService.findActiveSessionByToken(token);

    if (!session) {
      throwAuthenticationRequired();
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: session.userId,
        tenantId: session.tenantId,
      },
      include: { roles: true },
    });

    if (!user || user.status !== "active") {
      throwAuthenticationRequired();
    }

    const roleCodes = user.roles.map((role) => role.roleCode);

    if (!roleCodes.includes(selectedRoleCode)) {
      throw new BadRequestException({
        code: "ROLE_NOT_ASSIGNED",
        message: "The selected role is not assigned to this user.",
      });
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSelectedRoleCode: selectedRoleCode },
    });

    await this.rotateSessionAfterPrivilegeChange(response, session.id);

    return {
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        name: updatedUser.name,
        status: updatedUser.status,
        lastSelectedRoleCode: updatedUser.lastSelectedRoleCode,
        lastSelectedZone: updatedUser.lastSelectedZone,
      },
      roleCodes,
      permissions: this.rolesService.getPermissionsForRoles(roleCodes),
    };
  }

  async switchZone(
    body: SwitchZoneRequestBody,
    request: Request,
    response: Response,
  ): Promise<LoginResponse> {
    if (!isValidZone(body.zone)) {
      throw new BadRequestException({
        code: "INVALID_ZONE",
        message: "A valid zone is required.",
      });
    }

    const selectedZone = body.zone;
    const token = readSessionToken(request);

    if (!token) {
      throwAuthenticationRequired();
    }

    const session = await this.sessionService.findActiveSessionByToken(token);

    if (!session) {
      throwAuthenticationRequired();
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: session.userId,
        tenantId: session.tenantId,
      },
      include: { roles: true },
    });

    if (!user || user.status !== "active") {
      throwAuthenticationRequired();
    }

    const roleCodes = user.roles.map((role) => role.roleCode);
    const permissions = this.rolesService.getPermissionsForRoles(roleCodes);

    if (!isZoneAvailable(selectedZone, permissions)) {
      throw new BadRequestException({
        code: "ZONE_NOT_AVAILABLE",
        message: "The selected zone is not available to this user.",
      });
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSelectedZone: selectedZone },
    });

    await this.rotateSessionAfterPrivilegeChange(response, session.id);

    return {
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        name: updatedUser.name,
        status: updatedUser.status,
        lastSelectedRoleCode: updatedUser.lastSelectedRoleCode,
        lastSelectedZone: updatedUser.lastSelectedZone,
      },
      roleCodes,
      permissions,
    };
  }

  /**
   * Mints a fresh session token after the session's privileges change, and
   * re-issues the cookies that depend on it.
   *
   * The CSRF cookie has to be rewritten too, not just the session one: the
   * CSRF token is an HMAC keyed on the session token (see csrf.ts), so a
   * rotated session leaves the old CSRF cookie unverifiable and every
   * subsequent mutation would fail with CSRF_TOKEN_INVALID.
   */
  private async rotateSessionAfterPrivilegeChange(
    response: Response,
    sessionId: string,
  ): Promise<void> {
    const rotatedToken =
      await this.sessionService.rotateSessionToken(sessionId);

    writeSessionCookie(response, rotatedToken);
    writeCsrfCookie(response, createCsrfToken(rotatedToken), CSRF_COOKIE_NAME);
  }
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  // Argon2 hashes whatever it is given, so an unbounded password is an
  // unbounded amount of hashing work per request — a cheap way to make the
  // login endpoint expensive. Not trimmed: leading and trailing spaces are
  // part of a password.
  if (!value || value.length > TEXT_LIMITS.password) {
    return null;
  }

  return value;
}

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

function normalizeRoleCode(value: unknown) {
  if (
    value === "company_admin" ||
    value === "team_manager" ||
    value === "field_representative"
  ) {
    return value;
  }

  return null;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const token = value.trim();

  // An invite token is a fixed-size base64url string; anything longer is not
  // one, and hashing an unbounded value to look it up is wasted work.
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

function throwInvalidCredentials(): never {
  throw new UnauthorizedException({
    code: "INVALID_CREDENTIALS",
    message: "Invalid email or password.",
  });
}

function throwAuthenticationRequired(): never {
  throw new UnauthorizedException({
    code: "AUTHENTICATION_REQUIRED",
    message: "Authentication is required.",
  });
}

function throwInvalidInvite(): never {
  throw new BadRequestException({
    code: "INVITE_INVALID",
    message: "Invite token is invalid or expired.",
  });
}
