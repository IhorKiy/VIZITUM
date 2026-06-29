import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { PrismaService } from "../prisma/prisma.service";
import { RolesService } from "../roles/roles.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { PasswordService } from "./password.service";
import { createCsrfToken, writeCsrfCookie } from "./csrf";
import { readSessionToken, writeSessionCookie } from "./session-cookie";
import { SessionService } from "./session.service";
import type {
  LoginRequestBody,
  LoginResponse,
  SwitchRoleRequestBody,
} from "./auth.types";

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

    const { tenant } = await this.tenancyService.resolveTenant({
      host: request.header("host"),
      path: request.path,
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

  async getCurrentUser(request: Request): Promise<LoginResponse> {
    const token = readSessionToken(request);

    if (!token) {
      throwAuthenticationRequired();
    }

    const session = await this.sessionService.findActiveSessionByToken(token);

    if (!session) {
      throwAuthenticationRequired();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: { roles: true },
    });

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

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
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

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();

  return email || null;
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value || null;
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
