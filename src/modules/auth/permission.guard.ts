import { timingSafeEqual } from "node:crypto";

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { isSessionActive } from "../../common/session-lifecycle";
import { readPlatformSessionToken } from "../platform/platform-session-cookie";
import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS, type PermissionCode } from "../roles/permissions";
import { ROLE_PERMISSION_MATRIX } from "../roles/role-permission.matrix";
import { RolesService } from "../roles/roles.service";
import type { RequestContext } from "../tenancy/request-context";
import { hashValue } from "./auth-crypto";
import { REQUIRED_PERMISSIONS_METADATA } from "./permissions.decorator";
import { REQUIRED_ANY_PERMISSIONS_METADATA } from "./permissions.decorator";
import { readSessionToken } from "./session-cookie";
import { SessionService } from "./session.service";

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly rolesService: RolesService,
    private readonly sessionService: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<
      PermissionCode[]
    >(REQUIRED_PERMISSIONS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAnyPermissions = this.reflector.getAllAndOverride<
      PermissionCode[]
    >(REQUIRED_ANY_PERMISSIONS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions?.length && !requiredAnyPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const requestContext = await this.buildRequestContext(request);
    const hasRequiredPermissions =
      !requiredPermissions?.length ||
      requiredPermissions.every((permission) =>
        requestContext.permissions.includes(permission),
      );
    const hasAnyRequiredPermission =
      !requiredAnyPermissions?.length ||
      requiredAnyPermissions.some((permission) =>
        requestContext.permissions.includes(permission),
      );

    if (!hasRequiredPermissions || !hasAnyRequiredPermission) {
      throw new ForbiddenException({
        code: "MISSING_PERMISSION",
        message: "You do not have permission to perform this action.",
        details: { requiredPermissions, requiredAnyPermissions },
      });
    }

    request.context = requestContext;

    return true;
  }

  private async buildRequestContext(request: Request): Promise<RequestContext> {
    const platformTokenContext = buildPlatformOperationsContext(request);

    if (platformTokenContext) {
      return platformTokenContext;
    }

    const platformSessionContext =
      await this.buildPlatformSessionContext(request);

    if (platformSessionContext) {
      return platformSessionContext;
    }

    const token = readSessionToken(request);

    if (!token) {
      throwUnauthorized();
    }

    const session = await this.sessionService.findActiveSessionByToken(token);

    if (!session) {
      throwUnauthorized();
    }

    const [tenant, user] = await Promise.all([
      this.prisma.platformTenant.findUnique({
        where: { id: session.tenantId },
      }),
      this.prisma.user.findFirst({
        where: {
          id: session.userId,
          tenantId: session.tenantId,
        },
        include: { roles: true },
      }),
    ]);

    if (!tenant || !user || user.status !== "active") {
      throwUnauthorized();
    }

    const roleCodes = user.roles.map((role) => role.roleCode);

    return {
      requestId: request.requestId ?? "unknown",
      tenantId: session.tenantId,
      tenantSlug: tenant.slug,
      userId: session.userId,
      roleCodes,
      permissions: this.rolesService.getPermissionsForRoles(roleCodes),
    };
  }

  private async buildPlatformSessionContext(
    request: Request,
  ): Promise<RequestContext | null> {
    const token = readPlatformSessionToken(request);

    if (!token) {
      return null;
    }

    const session = await this.prisma.platformSession.findUnique({
      where: { sessionTokenHash: hashValue(token) },
      include: { platformUser: true },
    });

    if (!session || !isSessionActive(session)) {
      return null;
    }

    const { platformUser } = session;

    if (!platformUser || platformUser.status !== "active") {
      return null;
    }

    return {
      requestId: request.requestId ?? "unknown",
      tenantId: "platform",
      tenantSlug: "platform",
      userId: platformUser.id,
      roleCodes: [],
      permissions: [...ROLE_PERMISSION_MATRIX.platform_owner],
    };
  }
}

function buildPlatformOperationsContext(
  request: Request,
): RequestContext | null {
  const token = readBearerToken(request);

  if (!token || !isValidPlatformOperationsToken(token)) {
    return null;
  }

  return {
    requestId: request.requestId ?? "unknown",
    tenantId: "platform",
    tenantSlug: "platform",
    roleCodes: [],
    permissions: [PERMISSIONS.PLATFORM_OPERATIONS_READ],
  };
}

function readBearerToken(request: Request): string | null {
  const authorization = request.header("authorization")?.trim();

  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authorization.slice("bearer ".length).trim();

  return token || null;
}

function isValidPlatformOperationsToken(token: string): boolean {
  const expectedHash = process.env.PLATFORM_OPERATIONS_TOKEN_SHA256?.trim();
  const tokenHash = hashValue(token);

  if (expectedHash) {
    return secureHashEquals(tokenHash, expectedHash);
  }

  const expectedToken = process.env.PLATFORM_OPERATIONS_TOKEN?.trim();

  if (!expectedToken) {
    return false;
  }

  return secureHashEquals(tokenHash, hashValue(expectedToken));
}

function secureHashEquals(actualHash: string, expectedHash: string): boolean {
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function throwUnauthorized(): never {
  throw new UnauthorizedException({
    code: "AUTHENTICATION_REQUIRED",
    message: "Authentication is required.",
  });
}
