import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { normalizeEmail } from "../../common/normalize";
import { PrismaService } from "../prisma/prisma.service";
import { RolesService } from "../roles/roles.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { hashValue } from "./auth-crypto";
import { PasswordService } from "./password.service";
import { createCsrfToken, writeCsrfCookie } from "./csrf";
import { readSessionToken, writeSessionCookie } from "./session-cookie";
import { SessionService } from "./session.service";
import type {
  AcceptInviteRequestBody,
  LoginRequestBody,
  LoginResponse,
  SwitchRoleRequestBody,
} from "./auth.types";
import { PRODUCTS_ENABLED_SETTING_KEY } from "../settings/settings.types";

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(PasswordService)
    private readonly passwordService: PasswordService,
    @Inject(RolesService)
    private readonly rolesService: RolesService,
    @Inject(SessionService)
    private readonly sessionService: SessionService,
    @Inject(TenancyService)
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
    writeCsrfCookie(response, createCsrfToken(token));

    const roleCodes = user.roles.map((role) => role.roleCode);
    const permissions = this.rolesService.getPermissionsForRoles(roleCodes);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        lastSelectedRoleCode: user.lastSelectedRoleCode,
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

    const user = await this.prisma.$transaction(async (tx) => {
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

      await tx.invite.update({
        where: { id: invite.id },
        data: {
          status: "accepted",
          acceptedAt: new Date(),
          acceptedByUserId: acceptedUser.id,
        },
      });

      return acceptedUser;
    });

    const { token: sessionToken } = await this.sessionService.createSession({
      tenantId: invite.tenantId,
      userId: user.id,
      userAgent: request.header("user-agent"),
      ipAddress: request.ip,
    });

    writeSessionCookie(response, sessionToken);
    writeCsrfCookie(response, createCsrfToken(sessionToken));

    const roleCodes = invite.roleCodes;

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        lastSelectedRoleCode: user.lastSelectedRoleCode,
      },
      roleCodes,
      permissions: this.rolesService.getPermissionsForRoles(roleCodes),
    };
  }

  async getCurrentUser(
    request: Request,
  ): Promise<LoginResponse & { productsEnabled: boolean }> {
    const token = readSessionToken(request);

    if (!token) {
      throwAuthenticationRequired();
    }

    const session = await this.sessionService.findActiveSessionByToken(token);

    if (!session) {
      throwAuthenticationRequired();
    }

    const [user, productsEnabledSetting] = await Promise.all([
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
      },
      roleCodes,
      permissions: this.rolesService.getPermissionsForRoles(roleCodes),
      productsEnabled: productsEnabledSetting
        ? productsEnabledSetting.value === true
        : true,
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
      },
      roleCodes,
      permissions: this.rolesService.getPermissionsForRoles(roleCodes),
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
