import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, VisitStatus } from "@prisma/client";

import {
  createPaginatedResponse,
  type PaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import type {
  CreateVisitRequestBody,
  ListVisitsQuery,
  UpdateVisitRequestBody,
  VisitResponse,
} from "./visits.types";

type VisitWithRelations = Prisma.VisitGetPayload<{
  include: {
    location: true;
    representative: true;
  };
}>;

@Injectable()
export class VisitsService {
  constructor(private readonly prisma: PrismaService) {}

  async listVisits(
    context: RequestContext,
    query: ListVisitsQuery,
  ): Promise<PaginatedResponse<VisitResponse>> {
    const pagination = resolvePagination(query);
    const where = buildVisitWhere(context, query);
    const [visits, total] = await Promise.all([
      this.prisma.visit.findMany({
        where,
        include: visitInclude,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.visit.count({ where }),
    ]);

    return createPaginatedResponse(
      visits.map(toVisitResponse),
      pagination,
      total,
    );
  }

  async getVisit(
    context: RequestContext,
    visitId: string,
  ): Promise<VisitResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanReadVisit(context, visit.representativeUserId);

    return toVisitResponse(visit);
  }

  async createVisit(
    context: RequestContext,
    body: CreateVisitRequestBody,
  ): Promise<VisitResponse> {
    if (!context.permissions.includes(PERMISSIONS.VISITS_CREATE)) {
      throwMissingVisitPermission();
    }

    const locationId = normalizeId(body.locationId);
    const representativeUserId =
      normalizeId(body.representativeUserId) ?? context.userId;
    const routeItemId = normalizeOptionalId(body.routeItemId);
    const visitType = normalizeRequiredString(body.visitType);

    if (!locationId || !representativeUserId || !visitType) {
      throw new BadRequestException({
        code: "VISIT_INVALID",
        message: "Location, representative and visit type are required.",
      });
    }

    this.assertCanCreateVisitForRepresentative(context, representativeUserId);
    await Promise.all([
      this.assertTenantLocation(context.tenantId, locationId),
      this.assertFieldRepresentative(context.tenantId, representativeUserId),
    ]);

    if (routeItemId) {
      await this.assertRouteItemMatchesVisit(
        context.tenantId,
        routeItemId,
        locationId,
        representativeUserId,
      );
    }

    const visit = await this.prisma.visit.create({
      data: {
        tenantId: context.tenantId,
        locationId,
        representativeUserId,
        routeItemId,
        visitType,
        status: "in_progress",
        startedAt: parseOptionalDateTime(body.startedAt) ?? new Date(),
      },
      include: visitInclude,
    });

    return toVisitResponse(visit);
  }

  async updateVisit(
    context: RequestContext,
    visitId: string,
    body: UpdateVisitRequestBody,
  ): Promise<VisitResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanUpdateVisit(context, visit.representativeUserId);

    const status = normalizeVisitStatus(body.status);
    const completedAt = parseOptionalDateTime(body.completedAt);
    const cancelledAt = parseOptionalDateTime(body.cancelledAt);

    const updatedVisit = await this.prisma.$transaction(async (tx) => {
      const result = await tx.visit.update({
        where: { id: visit.id },
        data: {
          ...(status ? { status } : {}),
          ...(body.startedAt !== undefined
            ? { startedAt: parseOptionalDateTime(body.startedAt) }
            : {}),
          ...(body.completedAt !== undefined ? { completedAt } : {}),
          ...(body.cancelledAt !== undefined ? { cancelledAt } : {}),
          ...(status === "completed" && body.completedAt === undefined
            ? { completedAt: new Date() }
            : {}),
          ...(status === "cancelled" && body.cancelledAt === undefined
            ? { cancelledAt: new Date() }
            : {}),
        },
        include: visitInclude,
      });

      if (result.routeItemId && status === "completed") {
        await tx.routeItem.update({
          where: { id: result.routeItemId },
          data: { status: "visited" },
        });
      }

      if (result.routeItemId && status === "cancelled") {
        await tx.routeItem.update({
          where: { id: result.routeItemId },
          data: { status: "skipped" },
        });
      }

      return result;
    });

    return toVisitResponse(updatedVisit);
  }

  private async findTenantVisit(
    tenantId: string,
    visitId: string,
  ): Promise<VisitWithRelations> {
    const visit = await this.prisma.visit.findFirst({
      where: {
        id: visitId,
        tenantId,
      },
      include: visitInclude,
    });

    if (!visit) {
      throw new NotFoundException({
        code: "VISIT_NOT_FOUND",
        message: "Visit was not found.",
      });
    }

    return visit;
  }

  private assertCanReadVisit(
    context: RequestContext,
    representativeUserId: string,
  ): void {
    if (context.permissions.includes(PERMISSIONS.VISITS_READ_TEAM)) {
      return;
    }

    if (
      context.permissions.includes(PERMISSIONS.VISITS_READ_OWN) &&
      context.userId === representativeUserId
    ) {
      return;
    }

    throwMissingVisitPermission();
  }

  private assertCanCreateVisitForRepresentative(
    context: RequestContext,
    representativeUserId: string,
  ): void {
    if (context.userId === representativeUserId) {
      return;
    }

    throw new ForbiddenException({
      code: "VISIT_SCOPE_FORBIDDEN",
      message: "You cannot create a visit for this representative.",
    });
  }

  private assertCanUpdateVisit(
    context: RequestContext,
    representativeUserId: string,
  ): void {
    if (
      context.permissions.includes(PERMISSIONS.VISITS_UPDATE_OWN) &&
      context.userId === representativeUserId
    ) {
      return;
    }

    throwMissingVisitPermission();
  }

  private async assertFieldRepresentative(
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const representative = await this.prisma.user.findFirst({
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

  private async assertTenantLocation(
    tenantId: string,
    locationId: string,
  ): Promise<void> {
    const location = await this.prisma.location.findFirst({
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

  private async assertRouteItemMatchesVisit(
    tenantId: string,
    routeItemId: string,
    locationId: string,
    representativeUserId: string,
  ): Promise<void> {
    const routeItem = await this.prisma.routeItem.findFirst({
      where: {
        id: routeItemId,
        tenantId,
        locationId,
        routePlan: {
          representativeUserId,
        },
      },
      select: { id: true },
    });

    if (!routeItem) {
      throw new BadRequestException({
        code: "ROUTE_ITEM_INVALID",
        message: "Route item must match the visit representative and location.",
      });
    }
  }
}

const visitInclude = {
  location: true,
  representative: true,
} satisfies Prisma.VisitInclude;

function buildVisitWhere(
  context: RequestContext,
  query: ListVisitsQuery,
): Prisma.VisitWhereInput {
  const requestedRepresentativeId = normalizeId(query.representativeUserId);
  const representativeFilter = context.permissions.includes(
    PERMISSIONS.VISITS_READ_TEAM,
  )
    ? requestedRepresentativeId
    : context.userId;

  if (!representativeFilter) {
    throwMissingVisitPermission();
  }

  return {
    tenantId: context.tenantId,
    representativeUserId: representativeFilter,
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

function normalizeOptionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return normalizeId(value);
}

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

function normalizeVisitStatus(value: unknown): VisitStatus | null {
  if (
    value === "draft" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return null;
}

function parseOptionalDateTime(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new BadRequestException({
      code: "DATETIME_INVALID",
      message: "Date time value must be an ISO string.",
    });
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      code: "DATETIME_INVALID",
      message: "Date time value must be an ISO string.",
    });
  }

  return date;
}

function toVisitResponse(visit: VisitWithRelations): VisitResponse {
  return {
    id: visit.id,
    locationId: visit.locationId,
    location: {
      id: visit.location.id,
      name: visit.location.name,
      addressLine: visit.location.addressLine,
      city: visit.location.city,
    },
    representativeUserId: visit.representativeUserId,
    representative: {
      id: visit.representative.id,
      email: visit.representative.email,
      name: visit.representative.name,
    },
    routeItemId: visit.routeItemId,
    visitType: visit.visitType,
    status: visit.status,
    startedAt: visit.startedAt?.toISOString() ?? null,
    completedAt: visit.completedAt?.toISOString() ?? null,
    cancelledAt: visit.cancelledAt?.toISOString() ?? null,
    createdAt: visit.createdAt.toISOString(),
    updatedAt: visit.updatedAt.toISOString(),
  };
}

function throwMissingVisitPermission(): never {
  throw new ForbiddenException({
    code: "VISIT_SCOPE_FORBIDDEN",
    message: "You cannot access this visit.",
  });
}
