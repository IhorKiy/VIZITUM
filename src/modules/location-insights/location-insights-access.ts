import { ForbiddenException, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";

// Shared by LocationPotentialService, LocationAssortmentService and
// LocationInsightsSummaryService (the one thing the two still share, now that
// their write rules are deliberately separate): :locationId is the primary
// resource in
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

// The assortment is a tenant-wide standard, so its write check is the plain
// permission — there is no ownership tier and therefore nothing to query, which
// is why this pair is synchronous while the potential's is not. It still feeds
// the `canManage` each list envelope returns, so the frontend can hide edit
// affordances the caller can't use.
export function canManageAssortment(context: RequestContext): boolean {
  return context.permissions.includes(PERMISSIONS.LOCATION_ASSORTMENT_MANAGE);
}

export function assertCanManageAssortment(context: RequestContext): void {
  if (!canManageAssortment(context)) {
    throw new ForbiddenException({
      code: "LOCATION_ASSORTMENT_SCOPE_FORBIDDEN",
      message: "You cannot manage the assortment for this location.",
    });
  }
}

// The potential is owned by the representative who works the outlet, so the
// write check is an ownership one: an active LocationAssignment, queried per
// request rather than read off a column, since potential rows carry no
// representative of their own.
export async function canManagePotential(
  context: RequestContext,
  prisma: PrismaService,
  locationId: string,
): Promise<boolean> {
  // The tenant-wide tier exists only as a repair path (tenant_superadmin, no
  // screen): potential rows outlive the assignment that created them, so
  // without it an unassigned rep's rows would be unfixable by anyone.
  if (context.permissions.includes(PERMISSIONS.LOCATION_POTENTIAL_MANAGE)) {
    return true;
  }

  if (
    !context.userId ||
    !context.permissions.includes(PERMISSIONS.LOCATION_POTENTIAL_MANAGE_OWN)
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

export async function assertCanManagePotential(
  context: RequestContext,
  prisma: PrismaService,
  locationId: string,
): Promise<void> {
  const canManage = await canManagePotential(context, prisma, locationId);

  if (!canManage) {
    throw new ForbiddenException({
      code: "LOCATION_POTENTIAL_SCOPE_FORBIDDEN",
      message: "You cannot manage the potential for this location.",
    });
  }
}
