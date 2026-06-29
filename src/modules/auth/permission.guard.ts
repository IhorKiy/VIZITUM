import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { PrismaService } from "../prisma/prisma.service";
import type { PermissionCode } from "../roles/permissions";
import { RolesService } from "../roles/roles.service";
import type { RequestContext } from "../tenancy/request-context";
import { REQUIRED_PERMISSIONS_METADATA } from "./permissions.decorator";
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

    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const requestContext = await this.buildRequestContext(request);
    const hasRequiredPermissions = requiredPermissions.every((permission) =>
      requestContext.permissions.includes(permission),
    );

    if (!hasRequiredPermissions) {
      throw new ForbiddenException({
        code: "MISSING_PERMISSION",
        message: "You do not have permission to perform this action.",
        details: { requiredPermissions },
      });
    }

    request.context = requestContext;

    return true;
  }

  private async buildRequestContext(request: Request): Promise<RequestContext> {
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
      this.prisma.user.findUnique({
        where: { id: session.userId },
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
}

function throwUnauthorized(): never {
  throw new UnauthorizedException({
    code: "AUTHENTICATION_REQUIRED",
    message: "Authentication is required.",
  });
}
