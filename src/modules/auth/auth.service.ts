import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

import { normalizeEmail } from "../../common/normalize";
import { withSerializationRetry } from "../../common/prisma-retry";
import { PrismaService } from "../prisma/prisma.service";
import { RolesService } from "../roles/roles.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { hashValue } from "./auth-crypto";
import { PasswordService } from "./password.service";
import { CSRF_COOKIE_NAME } from "./auth.constants";
import { createCsrfToken, writeCsrfCookie } from "./csrf";
import { readSessionToken, writeSessionCookie } from "./session-cookie";
import { SessionService } from "./session.service";
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

    if (!user || user.status !== "active" || !user.passwordHash) {
      throwInvalidCredentials();
    }

    const passwordMatches = await this.passwordService.verifyPassword(
      user.passwordHash,
      password,
    );

    if (!passwordMatches) {
      throwInvalidCredentials();
    }

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
    const name = normalizeName(body.name);
    const password = normalizeNewPassword(body.password);
    const phone = normalizeOptionalString(body.phone);

    if (!token || !name || !password) {
      throw new BadRequestException({
        code: "INVITE_ACCEPTANCE_INVALID",
        message: "Invite token, name and password are required.",
        fieldErrors: {
          token: token ? [] : ["Invite token is required."],
          name: name ? [] : ["Name is required."],
          password: password ? [] : ["Password must be at least 8 characters."],
        },
      });
    }

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
              name,
              phone,
              passwordHash,
              status: "active",
              lastSelectedRoleCode: invite.roleCodes[0] ?? null,
            },
            update: {
              name,
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

          await tx.invite.update({
            where: { id: invite.id },
            data: {
              status: "accepted",
              acceptedAt: new Date(),
              acceptedByUserId: acceptedUser.id,
            },
          });

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

    const [user, productsEnabledSetting, locationCategoriesEnabledSetting, tenant] =
      await Promise.all([
        this.prisma.user.findFirst({
          where: {
            id: session.userId,
            tenantId: session.tenantId,
          },
          include: { roles: true },
        }),
        this.prisma.tenantSetting.findUnique({
          where: {
            tenantId_key: {
              tenantId: session.tenantId,
              key: PRODUCTS_ENABLED_SETTING_KEY,
            },
          },
        }),
        this.prisma.tenantSetting.findUnique({
          where: {
            tenantId_key: {
              tenantId: session.tenantId,
              key: LOCATION_CATEGORIES_ENABLED_SETTING_KEY,
            },
          },
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

    return {
      user: {
        id: user.id,
        email: user.email,
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

    return {
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
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

    return {
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        status: updatedUser.status,
        lastSelectedRoleCode: updatedUser.lastSelectedRoleCode,
        lastSelectedZone: updatedUser.lastSelectedZone,
      },
      roleCodes,
      permissions,
    };
  }
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value || null;
}

function normalizeTenantSlug(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  return normalizedValue || null;
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

  return token || null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.trim();

  return name || null;
}

function normalizeNewPassword(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 8) {
    return null;
  }

  return value;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
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
