import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";

// Shared by RoutesService and RouteTemplatesService so plan and template
// ownership can never drift apart into two different security checks.
export function assertCanManageRouteForRepresentative(
  context: RequestContext,
  representativeUserId: string,
): void {
  if (context.permissions.includes(PERMISSIONS.ROUTES_MANAGE_TEAM)) {
    return;
  }

  if (
    context.permissions.includes(PERMISSIONS.ROUTES_MANAGE_OWN) &&
    context.userId === representativeUserId
  ) {
    return;
  }

  throw new ForbiddenException({
    code: "ROUTE_SCOPE_FORBIDDEN",
    message: "You cannot manage this representative route.",
  });
}

// The read counterpart of the check above, shared for the same reason: plan
// and template lists must answer "whose routes may I see" identically.
//
// Returns the representative id a list must be narrowed to, or `null` for a
// team-wide caller who named no one — which means every representative in the
// tenant, not none, the same way getTodayRoutes reads that permission. A
// caller who is not team-wide is always pinned to themselves, so an id they
// are not allowed to read is ignored rather than honoured.
export function resolveRouteRepresentativeFilter(
  context: RequestContext,
  requestedRepresentativeId: string | null,
): string | null {
  if (context.permissions.includes(PERMISSIONS.ROUTES_MANAGE_TEAM)) {
    return requestedRepresentativeId;
  }

  if (!context.userId) {
    throwAuthenticationContextMissing();
  }

  return context.userId;
}

export async function assertFieldRepresentative(
  prisma: PrismaService,
  tenantId: string,
  userId: string,
): Promise<void> {
  const representative = await prisma.user.findFirst({
    where: {
      id: userId,
      tenantId,
      deletedAt: null,
      status: "active",
      roles: {
        some: {
          tenantId,
          roleCode: "field_representative",
        },
      },
    },
    select: { id: true },
  });

  if (!representative) {
    throw new BadRequestException({
      code: "REPRESENTATIVE_INVALID",
      message: "Representative must be an active field representative.",
    });
  }
}

export async function assertTenantLocation(
  prisma: PrismaService,
  tenantId: string,
  locationId: string,
): Promise<void> {
  const location = await prisma.location.findFirst({
    where: {
      id: locationId,
      tenantId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!location) {
    throw new BadRequestException({
      code: "LOCATION_INVALID",
      message: "Location must exist in this tenant.",
    });
  }
}

export function throwAuthenticationContextMissing(): never {
  throw new ForbiddenException({
    code: "AUTHENTICATION_CONTEXT_MISSING",
    message: "Authentication context is missing.",
  });
}
