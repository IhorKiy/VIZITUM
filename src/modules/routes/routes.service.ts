import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  type RouteItemStatus,
  type RoutePlan,
  type RouteStatus,
} from "@prisma/client";

import {
  createPaginatedResponse,
  type PaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import {
  assertCanManageRouteForRepresentative,
  assertFieldRepresentative,
  assertTenantLocation,
  throwAuthenticationContextMissing,
} from "./route-access";
import {
  normalizeId,
  normalizeIdList,
  normalizePositiveInteger,
  parseDateOnly,
} from "./route-parsing";
import type {
  CreateRouteItemRequestBody,
  CreateRoutePlanRequestBody,
  ListRoutesQuery,
  ReorderRouteItemsRequestBody,
  RoutePlanResponse,
  UpdateRouteItemRequestBody,
  UpdateRoutePlanRequestBody,
} from "./routes.types";

export type RoutePlanWithRelations = Prisma.RoutePlanGetPayload<{
  include: {
    representative: true;
    routeTemplate: true;
    items: {
      include: {
        location: {
          include: {
            chain: true;
          };
        };
      };
    };
  };
}>;

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

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

    assertCanManageRouteForRepresentative(context, representativeUserId);
    await assertFieldRepresentative(
      this.prisma,
      context.tenantId,
      representativeUserId,
    );

    // Get-or-create against the partial unique index scoped to
    // routeTemplateId IS NULL (route_plans_rep_date_no_template_key) — a
    // representative can hold several template-based plans on the same day
    // now, but still at most one template-less manual plan, so this can no
    // longer upsert on a plain (tenantId, representativeUserId, planDate)
    // compound key the way it did before that index was split in two (see
    // the 20260721000000_route_plan_multi_per_day migration).
    const existingPlan = await this.prisma.routePlan.findFirst({
      where: {
        tenantId: context.tenantId,
        representativeUserId,
        planDate,
        routeTemplateId: null,
      },
      include: routePlanInclude,
    });

    if (existingPlan) {
      return toRoutePlanResponse(existingPlan);
    }

    try {
      const plan = await this.prisma.routePlan.create({
        data: {
          tenantId: context.tenantId,
          representativeUserId,
          planDate,
          createdByUserId: context.userId,
        },
        include: routePlanInclude,
      });

      return toRoutePlanResponse(plan);
    } catch (error) {
      // Guards against a concurrent create racing this exact (rep, date)
      // pair between the findFirst above and this create.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException({
          code: "ROUTE_PLAN_ALREADY_EXISTS",
          message: "A route is already planned for this date.",
        });
      }

      throw error;
    }
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

  // Draft-only: a plan that's been published/started/completed represents
  // real field work (visits may already reference its items), so it can't be
  // pulled out from under a representative this way. Draft is exactly the
  // pre-execution window — freshly template-assigned plans start there and
  // stay there until the representative (or a manager) publishes them.
  async deleteRoutePlan(
    context: RequestContext,
    routePlanId: string,
  ): Promise<{ deleted: true }> {
    const plan = await this.findTenantRoutePlan(context, routePlanId);

    if (plan.status !== "draft") {
      throw new ConflictException({
        code: "ROUTE_PLAN_NOT_REMOVABLE",
        message: "Only a draft route plan can be removed.",
      });
    }

    // One transaction with the audit event: a delete must never exist
    // without its `route_plan.deleted` trail, nor a trail without the delete
    // (mirrors TasksService.deleteTask).
    await this.prisma.$transaction(async (tx) => {
      await tx.routePlan.delete({ where: { id: plan.id } });

      await this.auditService.recordEvent(
        context,
        {
          entityType: "route_plan",
          entityId: plan.id,
          eventType: "route_plan.deleted",
        },
        tx,
      );
    });

    return { deleted: true };
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

    await assertTenantLocation(this.prisma, context.tenantId, locationId);

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
      await assertTenantLocation(this.prisma, context.tenantId, locationId);
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

  // Same two-phase update as RouteTemplatesService.reorderRouteTemplateItems:
  // bump every item to a sequence beyond the current max first, then assign
  // final positions, so no step can ever race the unique
  // (tenantId, routePlanId, sequence) index against a slot this same call
  // hasn't vacated yet.
  async reorderRouteItems(
    context: RequestContext,
    routePlanId: string,
    body: ReorderRouteItemsRequestBody,
  ): Promise<RoutePlanResponse> {
    const plan = await this.findTenantRoutePlan(context, routePlanId);
    const items = await this.prisma.routeItem.findMany({
      where: { tenantId: context.tenantId, routePlanId: plan.id },
    });
    const orderedIds = normalizeIdList(body.itemIds);
    const currentIds = new Set(items.map((item) => item.id));
    const isValidPermutation =
      orderedIds !== null &&
      orderedIds.length === items.length &&
      new Set(orderedIds).size === orderedIds.length &&
      orderedIds.every((id) => currentIds.has(id));

    if (!orderedIds || !isValidPermutation) {
      throw new BadRequestException({
        code: "ROUTE_ITEM_REORDER_INVALID",
        message: "itemIds must list every stop in this route exactly once.",
      });
    }

    const maxSequence = Math.max(...items.map((item) => item.sequence));

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const [index, id] of orderedIds.entries()) {
          await tx.routeItem.update({
            where: { id },
            data: { sequence: maxSequence + index + 1 },
          });
        }

        for (const [index, id] of orderedIds.entries()) {
          await tx.routeItem.update({
            where: { id },
            data: { sequence: index + 1 },
          });
        }
      });
    } catch (error) {
      throw toSequenceConflictOrRethrow(error);
    }

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

    assertCanManageRouteForRepresentative(context, plan.representativeUserId);

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

export const routePlanInclude = {
  representative: true,
  routeTemplate: true,
  items: {
    include: {
      location: {
        include: {
          chain: true,
        },
      },
    },
    orderBy: { sequence: "asc" },
  },
} satisfies Prisma.RoutePlanInclude;

// The frontend computes the next sequence client-side (current max + 1), so
// two concurrent edits on the same route plan can race for the same slot;
// without this the unique (tenantId, routePlanId, sequence) index would
// surface as an unhandled 500 instead of a 409 the client can react to.
function toSequenceConflictOrRethrow(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return new ConflictException({
      code: "ROUTE_ITEM_SEQUENCE_TAKEN",
      message: "Another stop already uses that position in this route.",
    });
  }

  return error;
}

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

export function toRoutePlanResponse(
  plan: RoutePlanWithRelations,
): RoutePlanResponse {
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
    routeTemplateId: plan.routeTemplateId,
    routeTemplate: plan.routeTemplate
      ? { id: plan.routeTemplate.id, name: plan.routeTemplate.name }
      : null,
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
        chain: item.location.chain
          ? { id: item.location.chain.id, name: item.location.chain.name }
          : null,
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
