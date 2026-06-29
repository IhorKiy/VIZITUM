import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  Prisma,
  RouteItemStatus,
  RoutePlan,
  RouteStatus,
} from "@prisma/client";

import {
  createPaginatedResponse,
  type PaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import type {
  CreateRouteItemRequestBody,
  CreateRoutePlanRequestBody,
  ListRoutesQuery,
  RoutePlanResponse,
  UpdateRouteItemRequestBody,
  UpdateRoutePlanRequestBody,
} from "./routes.types";

type RoutePlanWithRelations = Prisma.RoutePlanGetPayload<{
  include: {
    representative: true;
    items: {
      include: {
        location: true;
      };
    };
  };
}>;

@Injectable()
export class RoutesService {
  constructor(private readonly prisma: PrismaService) {}

  async getTodayRoutes(context: RequestContext): Promise<RoutePlanResponse[]> {
    const today = parseRequiredDateOnly(new Date().toISOString().slice(0, 10));

    if (context.permissions.includes(PERMISSIONS.ROUTES_MANAGE_TEAM)) {
      const plans = await this.prisma.routePlan.findMany({
        where: {
          tenantId: context.tenantId,
          planDate: today,
        },
        include: routePlanInclude,
        orderBy: { createdAt: "desc" },
      });

      return plans.map(toRoutePlanResponse);
    }

    if (!context.userId) {
      throwAuthenticationContextMissing();
    }

    const plans = await this.prisma.routePlan.findMany({
      where: {
        tenantId: context.tenantId,
        representativeUserId: context.userId,
        planDate: today,
      },
      include: routePlanInclude,
      orderBy: { createdAt: "desc" },
    });

    return plans.map(toRoutePlanResponse);
  }

  async listRoutes(
    context: RequestContext,
    query: ListRoutesQuery,
  ): Promise<PaginatedResponse<RoutePlanResponse>> {
    const pagination = resolvePagination(query);
    const where = buildRoutePlanWhere(context, query);
    const [plans, total] = await Promise.all([
      this.prisma.routePlan.findMany({
        where,
        include: routePlanInclude,
        orderBy: [{ planDate: "desc" }, { createdAt: "desc" }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.routePlan.count({ where }),
    ]);

    return createPaginatedResponse(
      plans.map(toRoutePlanResponse),
      pagination,
      total,
    );
  }

  async createRoutePlan(
    context: RequestContext,
    body: CreateRoutePlanRequestBody,
  ): Promise<RoutePlanResponse> {
    const representativeUserId = normalizeId(body.representativeUserId);
    const planDate = parseDateOnly(body.planDate);

    if (!representativeUserId || !planDate) {
      throw new BadRequestException({
        code: "ROUTE_PLAN_INVALID",
        message: "Representative user id and plan date are required.",
      });
    }

    this.assertCanManageRouteForRepresentative(context, representativeUserId);
    await this.assertFieldRepresentative(
      context.tenantId,
      representativeUserId,
    );

    const plan = await this.prisma.routePlan.upsert({
      where: {
        tenantId_representativeUserId_planDate: {
          tenantId: context.tenantId,
          representativeUserId,
          planDate,
        },
      },
      create: {
        tenantId: context.tenantId,
        representativeUserId,
        planDate,
        createdByUserId: context.userId,
      },
      update: {},
      include: routePlanInclude,
    });

    return toRoutePlanResponse(plan);
  }

  async updateRoutePlan(
    context: RequestContext,
    routePlanId: string,
    body: UpdateRoutePlanRequestBody,
  ): Promise<RoutePlanResponse> {
    const plan = await this.findTenantRoutePlan(context, routePlanId);
    const status = normalizeRouteStatus(body.status);
    const publishedAt = parseOptionalDateTime(body.publishedAt);

    const updatedPlan = await this.prisma.routePlan.update({
      where: { id: plan.id },
      data: {
        ...(status ? { status } : {}),
        ...(body.publishedAt !== undefined ? { publishedAt } : {}),
      },
      include: routePlanInclude,
    });

    return toRoutePlanResponse(updatedPlan);
  }

  async createRouteItem(
    context: RequestContext,
    routePlanId: string,
    body: CreateRouteItemRequestBody,
  ): Promise<RoutePlanResponse> {
    const plan = await this.findTenantRoutePlan(context, routePlanId);
    const locationId = normalizeId(body.locationId);
    const sequence = normalizePositiveInteger(body.sequence);

    if (!locationId || !sequence) {
      throw new BadRequestException({
        code: "ROUTE_ITEM_INVALID",
        message: "Location id and sequence are required.",
      });
    }

    await this.assertTenantLocation(context.tenantId, locationId);

    await this.prisma.routeItem.create({
      data: {
        tenantId: context.tenantId,
        routePlanId: plan.id,
        locationId,
        sequence,
        plannedStartTime: parseOptionalDateTime(body.plannedStartTime),
        plannedEndTime: parseOptionalDateTime(body.plannedEndTime),
      },
    });

    return this.getRoutePlanResponse(plan.id);
  }

  async updateRouteItem(
    context: RequestContext,
    routePlanId: string,
    routeItemId: string,
    body: UpdateRouteItemRequestBody,
  ): Promise<RoutePlanResponse> {
    const plan = await this.findTenantRoutePlan(context, routePlanId);
    const item = await this.findTenantRouteItem(
      context.tenantId,
      plan.id,
      routeItemId,
    );
    const locationId = normalizeId(body.locationId);
    const sequence = normalizePositiveInteger(body.sequence);
    const status = normalizeRouteItemStatus(body.status);

    if (locationId) {
      await this.assertTenantLocation(context.tenantId, locationId);
    }

    await this.prisma.routeItem.update({
      where: { id: item.id },
      data: {
        ...(locationId ? { locationId } : {}),
        ...(sequence ? { sequence } : {}),
        ...(status ? { status } : {}),
        ...(body.plannedStartTime !== undefined
          ? { plannedStartTime: parseOptionalDateTime(body.plannedStartTime) }
          : {}),
        ...(body.plannedEndTime !== undefined
          ? { plannedEndTime: parseOptionalDateTime(body.plannedEndTime) }
          : {}),
        ...(body.skipReason !== undefined
          ? { skipReason: normalizeOptionalString(body.skipReason) }
          : {}),
      },
    });

    return this.getRoutePlanResponse(plan.id);
  }

  private async findTenantRoutePlan(
    context: RequestContext,
    routePlanId: string,
  ): Promise<RoutePlan> {
    const plan = await this.prisma.routePlan.findFirst({
      where: {
        id: routePlanId,
        tenantId: context.tenantId,
      },
    });

    if (!plan) {
      throw new NotFoundException({
        code: "ROUTE_PLAN_NOT_FOUND",
        message: "Route plan was not found.",
      });
    }

    this.assertCanManageRouteForRepresentative(
      context,
      plan.representativeUserId,
    );

    return plan;
  }

  private async getRoutePlanResponse(
    routePlanId: string,
  ): Promise<RoutePlanResponse> {
    const plan = await this.prisma.routePlan.findUniqueOrThrow({
      where: { id: routePlanId },
      include: routePlanInclude,
    });

    return toRoutePlanResponse(plan);
  }

  private assertCanManageRouteForRepresentative(
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

  private async findTenantRouteItem(
    tenantId: string,
    routePlanId: string,
    routeItemId: string,
  ) {
    const item = await this.prisma.routeItem.findFirst({
      where: {
        id: routeItemId,
        tenantId,
        routePlanId,
      },
    });

    if (!item) {
      throw new NotFoundException({
        code: "ROUTE_ITEM_NOT_FOUND",
        message: "Route item was not found.",
      });
    }

    return item;
  }
}

const routePlanInclude = {
  representative: true,
  items: {
    include: {
      location: true,
    },
    orderBy: { sequence: "asc" },
  },
} satisfies Prisma.RoutePlanInclude;

function buildRoutePlanWhere(
  context: RequestContext,
  query: ListRoutesQuery,
): Prisma.RoutePlanWhereInput {
  const requestedRepresentativeId = normalizeId(query.representativeUserId);
  const representativeFilter = context.permissions.includes(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
  )
    ? requestedRepresentativeId
    : context.userId;

  if (!representativeFilter) {
    throwAuthenticationContextMissing();
  }

  return {
    tenantId: context.tenantId,
    representativeUserId: representativeFilter,
    ...(query.planDate
      ? { planDate: parseRequiredDateOnly(query.planDate) }
      : {}),
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

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
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

function normalizeRouteStatus(value: unknown): RouteStatus | null {
  if (
    value === "draft" ||
    value === "published" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return null;
}

function normalizeRouteItemStatus(value: unknown): RouteItemStatus | null {
  if (value === "planned" || value === "visited" || value === "skipped") {
    return value;
  }

  return null;
}

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return new Date(`${value}T00:00:00.000Z`);
}

function parseRequiredDateOnly(value: unknown): Date {
  const date = parseDateOnly(value);

  if (!date) {
    throw new BadRequestException({
      code: "DATE_INVALID",
      message: "Date value must use YYYY-MM-DD format.",
    });
  }

  return date;
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

function toRoutePlanResponse(plan: RoutePlanWithRelations): RoutePlanResponse {
  return {
    id: plan.id,
    representativeUserId: plan.representativeUserId,
    representative: {
      id: plan.representative.id,
      email: plan.representative.email,
      name: plan.representative.name,
    },
    planDate: plan.planDate.toISOString().slice(0, 10),
    status: plan.status,
    publishedAt: plan.publishedAt?.toISOString() ?? null,
    createdByUserId: plan.createdByUserId,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    items: plan.items.map((item) => ({
      id: item.id,
      locationId: item.locationId,
      location: {
        id: item.location.id,
        name: item.location.name,
        addressLine: item.location.addressLine,
        city: item.location.city,
      },
      sequence: item.sequence,
      status: item.status,
      plannedStartTime: item.plannedStartTime?.toISOString() ?? null,
      plannedEndTime: item.plannedEndTime?.toISOString() ?? null,
      skipReason: item.skipReason,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}

function throwAuthenticationContextMissing(): never {
  throw new ForbiddenException({
    code: "AUTHENTICATION_CONTEXT_MISSING",
    message: "Authentication context is missing.",
  });
}
