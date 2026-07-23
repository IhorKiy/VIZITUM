import { ForbiddenException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";

// Shared by the two checks below: the same "does this rep hold a live
// assignment to this location" question backs both the location-note and
// the contacts ownership tiers, kept as one query shape so the two never
// drift (mirrors location-insights-access.ts's identical check for
// Potential/Assortment, kept separate here rather than reused directly
// since it's hardcoded to the LOCATION_INSIGHTS_* permission pair).
async function hasActiveLocationAssignment(
  prisma: PrismaService,
  tenantId: string,
  locationId: string,
  userId: string | undefined,
): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const assignment = await prisma.locationAssignment.findFirst({
    where: {
      tenantId,
      locationId,
      representativeUserId: userId,
      status: "active",
    },
    select: { id: true },
  });

  return assignment !== null;
}

export async function canManageLocationNotes(
  context: RequestContext,
  prisma: PrismaService,
  locationId: string,
): Promise<boolean> {
  if (context.permissions.includes(PERMISSIONS.LOCATION_NOTES_MANAGE)) {
    return true;
  }

  if (!context.permissions.includes(PERMISSIONS.LOCATION_NOTES_MANAGE_OWN)) {
    return false;
  }

  return hasActiveLocationAssignment(
    prisma,
    context.tenantId,
    locationId,
    context.userId,
  );
}

export async function assertCanManageLocationNotes(
  context: RequestContext,
  prisma: PrismaService,
  locationId: string,
): Promise<void> {
  const canManage = await canManageLocationNotes(context, prisma, locationId);

  if (!canManage) {
    throw new ForbiddenException({
      code: "LOCATION_NOTES_SCOPE_FORBIDDEN",
      message: "You cannot manage the note for this location.",
    });
  }
}

export async function canManageContacts(
  context: RequestContext,
  prisma: PrismaService,
  locationId: string,
): Promise<boolean> {
  if (context.permissions.includes(PERMISSIONS.CONTACTS_MANAGE)) {
    return true;
  }

  if (!context.permissions.includes(PERMISSIONS.CONTACTS_MANAGE_OWN)) {
    return false;
  }

  return hasActiveLocationAssignment(
    prisma,
    context.tenantId,
    locationId,
    context.userId,
  );
}

export async function assertCanManageContacts(
  context: RequestContext,
  prisma: PrismaService,
  locationId: string,
): Promise<void> {
  const canManage = await canManageContacts(context, prisma, locationId);

  if (!canManage) {
    throw new ForbiddenException({
      code: "CONTACTS_SCOPE_FORBIDDEN",
      message: "You cannot manage contacts for this location.",
    });
  }
}

// Combined read for getLocation: resolves both the note and contacts manage
// flags with at most a single locationAssignment lookup. Calling
// canManageLocationNotes and canManageContacts separately would run two
// identical assignment queries for a field rep; this shares one. The write
// paths keep using the per-feature asserts above (a write touches only one
// feature, so it never pays for the other's check).
export async function canManageLocationHeader(
  context: RequestContext,
  prisma: PrismaService,
  locationId: string,
): Promise<{ canManageNotes: boolean; canManageContacts: boolean }> {
  const notesManage = context.permissions.includes(
    PERMISSIONS.LOCATION_NOTES_MANAGE,
  );
  const notesOwn =
    !notesManage &&
    context.permissions.includes(PERMISSIONS.LOCATION_NOTES_MANAGE_OWN);
  const contactsManage = context.permissions.includes(
    PERMISSIONS.CONTACTS_MANAGE,
  );
  const contactsOwn =
    !contactsManage &&
    context.permissions.includes(PERMISSIONS.CONTACTS_MANAGE_OWN);

  // Only query when an own-tier permission actually needs resolving.
  const assigned =
    notesOwn || contactsOwn
      ? await hasActiveLocationAssignment(
          prisma,
          context.tenantId,
          locationId,
          context.userId,
        )
      : false;

  return {
    canManageNotes: notesManage || (notesOwn && assigned),
    canManageContacts: contactsManage || (contactsOwn && assigned),
  };
}
