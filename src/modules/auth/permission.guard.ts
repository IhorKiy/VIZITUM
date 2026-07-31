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

import { isSessionActive, touchSession } from "../../common/session-lifecycle";
import { PLATFORM_SESSION_IDLE_TIMEOUT_HOURS } from "../platform/platform-auth.constants";
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
    const candidates = await this.buildRequestContextCandidates(request);

    if (candidates.length === 0) {
      throwUnauthorized();
    }

    const satisfiesRequirement = (requestContext: RequestContext) => {
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

      return hasRequiredPermissions && hasAnyRequiredPermission;
    };

    const requestContext = candidates.find(satisfiesRequirement);

    if (!requestContext) {
      throw new ForbiddenException({
        code: "MISSING_PERMISSION",
        message: "You do not have permission to perform this action.",
        details: { requiredPermissions, requiredAnyPermissions },
      });
    }

    request.context = requestContext;

    return true;
  }

  // A single browser can legitimately hold both a platform-owner session
  // cookie and a tenant session cookie at once (e.g. a platform owner
  // accepting a tenant invite in the same tab used to create the tenant) —
  // both cookies are set with `path: "/"`, so nothing keeps them from
  // coexisting regardless of which app the request is "for". Resolving
  // every credential actually present and picking whichever one satisfies
  // the route's declared requirement (rather than always preferring the
  // platform session) keeps a valid tenant session from being silently
  // shadowed. Permission sets never overlap between platform_owner and
  // tenant roles, so there's no ambiguity in which candidate "should" win.
  private async buildRequestContextCandidates(
    request: Request,
  ): Promise<RequestContext[]> {
    const candidates: RequestContext[] = [];

    const platformTokenContext = buildPlatformOperationsContext(request);

    if (platformTokenContext) {
      candidates.push(platformTokenContext);
    }

    const [platformSessionContext, tenantSessionContext] = await Promise.all([
      this.buildPlatformSessionContext(request),
      this.buildTenantSessionContext(request),
    ]);

    if (platformSessionContext) {
      candidates.push(platformSessionContext);
    }

    if (tenantSessionContext) {
      candidates.push(tenantSessionContext);
    }

    return candidates;
  }

  private async buildTenantSessionContext(
    request: Request,
  ): Promise<RequestContext | null> {
    const token = readSessionToken(request);

    if (!token) {
      return null;
    }

    const session = await this.sessionService.findActiveSessionByToken(token);

    if (!session) {
      return null;
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
      return null;
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

    // Same idle deadline PlatformSessionService applies. This is a second,
    // inline copy of that check (the guard queries the row directly), so the
    // timeout has to be passed here too — otherwise the console's own
    // endpoints would keep honouring a session /platform/auth/me has already
    // stopped accepting.
    if (
      !session ||
      !isSessionActive(session, PLATFORM_SESSION_IDLE_TIMEOUT_HOURS)
    ) {
      return null;
    }

    // Keeps lastSeenAt current on every authenticated request, not just
    // /platform/auth/me — see touchSession's doc comment for why this is
    // shared instead of an inline update.
    await touchSession(this.prisma.platformSession, session.id);

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
