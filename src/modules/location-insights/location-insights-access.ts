import { ForbiddenException, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";

// Shared by LocationPotentialService, LocationAssortmentService and
// LocationInsightsSummaryService: :locationId is the primary resource in
// these URLs, so a missing/wrong-tenant id is 404 LOCATION_NOT_FOUND, the
// same convention locations.controller.ts uses for its own primary resource
// (not route-access.ts's 400 LOCATION_INVALID, which validates a nested
// reference on a different primary resource).
export async function findTenantLocationOrThrow(
  prisma: PrismaService,
  tenantId: string,
  locationId: string,
): Promise<void> {
  const location = await prisma.location.findFirst({
    where: { id: locationId, tenantId, deletedAt: null },
    select: { id: true },
  });

  if (!location) {
    throw new NotFoundException({
      code: "LOCATION_NOT_FOUND",
      message: "Location was not found.",
    });
  }
}

// Shared by LocationPotentialService and LocationAssortmentService so a
// field representative's write access to a location can never drift into two
// different checks. The non-throwing form also answers the frontend's "hide
// edit affordances I can't use" question via each list envelope's `canManage`.
export async function canManageLocationInsights(
  context: RequestContext,
  prisma: PrismaService,
  locationId: string,
): Promise<boolean> {
  if (context.permissions.includes(PERMISSIONS.LOCATION_INSIGHTS_MANAGE)) {
    return true;
  }

  if (
    !context.userId ||
    !context.permissions.includes(PERMISSIONS.LOCATION_INSIGHTS_MANAGE_OWN)
  ) {
    return false;
  }

  const assignment = await prisma.locationAssignment.findFirst({
    where: {
      tenantId: context.tenantId,
      locationId,
      representativeUserId: context.userId,
      status: "active",
    },
    select: { id: true },
  });

  return assignment !== null;
}

export async function assertCanManageLocationInsights(
  context: RequestContext,
  prisma: PrismaService,
  locationId: string,
): Promise<void> {
  const canManage = await canManageLocationInsights(
    context,
    prisma,
    locationId,
  );

  if (!canManage) {
    throw new ForbiddenException({
      code: "LOCATION_INSIGHTS_SCOPE_FORBIDDEN",
      message: "You cannot manage potential or assortment for this location.",
    });
  }
}
