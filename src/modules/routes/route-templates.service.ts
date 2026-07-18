import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

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
  normalizePositiveInteger,
  parseDateOnly,
} from "./route-parsing";
import { routePlanInclude, toRoutePlanResponse } from "./routes.service";
import type {
  AssignRouteTemplateRequestBody,
  CopyRouteTemplatePlansRequestBody,
  CopyRouteTemplatePlansResponse,
  CreateRouteTemplateItemRequestBody,
  CreateRouteTemplateRequestBody,
  ListRouteTemplatesQuery,
  MoveRouteTemplateItemRequestBody,
  RoutePlanResponse,
  RouteTemplateResponse,
  UpdateRouteTemplateItemRequestBody,
  UpdateRouteTemplateRequestBody,
} from "./routes.types";

type RouteTemplateWithItems = Prisma.RouteTemplateGetPayload<{
  include: typeof routeTemplateInclude;
}>;

@Injectable()
export class RouteTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listRouteTemplates(
    context: RequestContext,
    query: ListRouteTemplatesQuery,
  ): Promise<PaginatedResponse<RouteTemplateResponse>> {
    const requestedRepresentativeId = normalizeId(query.representativeUserId);
    const representativeFilter = context.permissions.includes(
      PERMISSIONS.ROUTES_MANAGE_TEAM,
    )
      ? requestedRepresentativeId
      : context.userId;

    if (!representativeFilter) {
      throwAuthenticationContextMissing();
    }

    const pagination = resolvePagination(query);
    const where = {
      tenantId: context.tenantId,
      representativeUserId: representativeFilter,
    };
    const [templates, total] = await Promise.all([
      this.prisma.routeTemplate.findMany({
        where,
        include: routeTemplateInclude,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.routeTemplate.count({ where }),
    ]);

    return createPaginatedResponse(
      templates.map(toRouteTemplateResponse),
      pagination,
      total,
    );
  }

  async getRouteTemplate(
    context: RequestContext,
    templateId: string,
  ): Promise<RouteTemplateResponse> {
    const template = await this.findTenantRouteTemplate(context, templateId);

    return toRouteTemplateResponse(template);
  }

  async createRouteTemplate(
    context: RequestContext,
    body: CreateRouteTemplateRequestBody,
  ): Promise<RouteTemplateResponse> {
    const representativeUserId = normalizeId(body.representativeUserId);
    const name = normalizeTemplateName(body.name);

    if (!representativeUserId || !name) {
      throw new BadRequestException({
        code: "ROUTE_TEMPLATE_INVALID",
        message: "Representative user id and name are required.",
      });
    }

    assertCanManageRouteForRepresentative(context, representativeUserId);
    await assertFieldRepresentative(
      this.prisma,
      context.tenantId,
      representativeUserId,
    );

    const template = await this.prisma.routeTemplate.create({
      data: {
        tenantId: context.tenantId,
        representativeUserId,
        name,
      },
      include: routeTemplateInclude,
    });

    return toRouteTemplateResponse(template);
  }

  async updateRouteTemplate(
    context: RequestContext,
    templateId: string,
    body: UpdateRouteTemplateRequestBody,
  ): Promise<RouteTemplateResponse> {
    const template = await this.findTenantRouteTemplate(context, templateId);
    const name = normalizeTemplateName(body.name);

    if (!name) {
      throw new BadRequestException({
        code: "ROUTE_TEMPLATE_INVALID",
        message: "Name is required.",
      });
    }

    const updated = await this.prisma.routeTemplate.update({
      where: { id: template.id },
      data: { name },
      include: routeTemplateInclude,
    });

    return toRouteTemplateResponse(updated);
  }

  async deleteRouteTemplate(
    context: RequestContext,
    templateId: string,
  ): Promise<{ deleted: true }> {
    const template = await this.findTenantRouteTemplate(context, templateId);

    // route_plans.routeTemplateId is ON DELETE SET NULL, so plans already
    // assigned from this template keep their items and just lose the back
    // link — deleting a template never touches scheduled or past plans. One
    // transaction with the audit event, same reasoning as
    // RoutesService.deleteRoutePlan: a delete must never exist without its
    // `route_template.deleted` trail, nor a trail without the delete.
    await this.prisma.$transaction(async (tx) => {
      await tx.routeTemplate.delete({ where: { id: template.id } });

      await this.auditService.recordEvent(
        context,
        {
          entityType: "route_template",
          entityId: template.id,
          eventType: "route_template.deleted",
        },
        tx,
      );
    });

    return { deleted: true };
  }

  async createRouteTemplateItem(
    context: RequestContext,
    templateId: string,
    body: CreateRouteTemplateItemRequestBody,
  ): Promise<RouteTemplateResponse> {
    const template = await this.findTenantRouteTemplate(context, templateId);
    const locationId = normalizeId(body.locationId);
    const sequence = normalizePositiveInteger(body.sequence);

    if (!locationId || !sequence) {
      throw new BadRequestException({
        code: "ROUTE_TEMPLATE_ITEM_INVALID",
        message: "Location id and sequence are required.",
      });
    }

    await assertTenantLocation(this.prisma, context.tenantId, locationId);

    try {
      await this.prisma.routeTemplateItem.create({
        data: {
          tenantId: context.tenantId,
          routeTemplateId: template.id,
          locationId,
          sequence,
        },
      });
    } catch (error) {
      throw toSequenceConflictOrRethrow(error);
    }

    return this.getRouteTemplateResponse(template.id);
  }

  async updateRouteTemplateItem(
    context: RequestContext,
    templateId: string,
    itemId: string,
    body: UpdateRouteTemplateItemRequestBody,
  ): Promise<RouteTemplateResponse> {
    const template = await this.findTenantRouteTemplate(context, templateId);
    const item = await this.findTenantRouteTemplateItem(
      context.tenantId,
      template.id,
      itemId,
    );
    const locationId = normalizeId(body.locationId);
    const sequence = normalizePositiveInteger(body.sequence);

    if (locationId) {
      await assertTenantLocation(this.prisma, context.tenantId, locationId);
    }

    try {
      await this.prisma.routeTemplateItem.update({
        where: { id: item.id },
        data: {
          ...(locationId ? { locationId } : {}),
          ...(sequence ? { sequence } : {}),
        },
      });
    } catch (error) {
      throw toSequenceConflictOrRethrow(error);
    }

    return this.getRouteTemplateResponse(template.id);
  }

  // Swaps an item with its neighbor above/below. All three sequence updates
  // run in one transaction: a mid-swap failure rolls the whole thing back
  // instead of leaving the item stranded at the temporary sequence (the
  // frontend used to orchestrate this as three separate PATCH requests).
  async moveRouteTemplateItem(
    context: RequestContext,
    templateId: string,
    itemId: string,
    body: MoveRouteTemplateItemRequestBody,
  ): Promise<RouteTemplateResponse> {
    const direction = normalizeDirection(body.direction);

    if (!direction) {
      throw new BadRequestException({
        code: "ROUTE_TEMPLATE_ITEM_MOVE_INVALID",
        message: 'Direction must be "up" or "down".',
      });
    }

    const template = await this.findTenantRouteTemplate(context, templateId);
    const items = [...template.items].sort((a, b) => a.sequence - b.sequence);
    const index = items.findIndex((item) => item.id === itemId);

    if (index < 0) {
      throw new NotFoundException({
        code: "ROUTE_TEMPLATE_ITEM_NOT_FOUND",
        message: "Route template stop was not found.",
      });
    }

    const otherIndex = direction === "up" ? index - 1 : index + 1;

    if (otherIndex < 0 || otherIndex >= items.length) {
      // Already at that edge of the list — nothing to swap with.
      return toRouteTemplateResponse(template);
    }

    const item = items[index];
    const other = items[otherIndex];
    // `items` is a snapshot from the top of this request, so two concurrent
    // moves on the same template can compute the same tempSequence — the
    // one that commits second hits the same unique-sequence P2002 as a
    // racing create/update and needs the same 409 treatment.
    const tempSequence = Math.max(...items.map((row) => row.sequence)) + 1;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.routeTemplateItem.update({
          where: { id: item.id },
          data: { sequence: tempSequence },
        });
        await tx.routeTemplateItem.update({
          where: { id: other.id },
          data: { sequence: item.sequence },
        });
        await tx.routeTemplateItem.update({
          where: { id: item.id },
          data: { sequence: other.sequence },
        });
      });
    } catch (error) {
      throw toSequenceConflictOrRethrow(error);
    }

    return this.getRouteTemplateResponse(template.id);
  }

  async deleteRouteTemplateItem(
    context: RequestContext,
    templateId: string,
    itemId: string,
  ): Promise<RouteTemplateResponse> {
    const template = await this.findTenantRouteTemplate(context, templateId);
    const item = await this.findTenantRouteTemplateItem(
      context.tenantId,
      template.id,
      itemId,
    );

    await this.prisma.routeTemplateItem.delete({ where: { id: item.id } });

    return this.getRouteTemplateResponse(template.id);
  }

  async assignRouteTemplate(
    context: RequestContext,
    templateId: string,
    body: AssignRouteTemplateRequestBody,
  ): Promise<RoutePlanResponse> {
    const template = await this.findTenantRouteTemplate(context, templateId);
    const planDate = parseDateOnly(body.planDate);

    if (!planDate) {
      throw new BadRequestException({
        code: "ROUTE_TEMPLATE_ASSIGN_INVALID",
        message: "Plan date is required.",
      });
    }

    return this.materializeTemplateAssignment(
      context.tenantId,
      template,
      planDate,
    );
  }

  // For each of the caller's own plans in the month before `month` that came
  // from a template, re-assigns the same template on the same day-of-month in
  // `month`. Days that don't exist in the target month (e.g. the 31st into a
  // 30-day month) and days that already have a plan are skipped, not errored.
  async copyRoutePlans(
    context: RequestContext,
    body: CopyRouteTemplatePlansRequestBody,
  ): Promise<CopyRouteTemplatePlansResponse> {
    const month = normalizeMonth(body.month);

    if (!month) {
      throw new BadRequestException({
        code: "ROUTE_COPY_MONTH_INVALID",
        message: "Month must use YYYY-MM format.",
      });
    }

    if (!context.userId) {
      throwAuthenticationContextMissing();
    }

    const representativeUserId = context.userId;
    const previousMonth = shiftMonth(month, -1);
    const nextMonth = shiftMonth(month, 1);

    // Both queries below are flat lookups (no per-day round trip): the
    // occupied-dates set and the referenced-templates map are each fetched
    // once, however many days are in the source month.
    const [sourcePlans, existingPlans] = await Promise.all([
      this.prisma.routePlan.findMany({
        where: {
          tenantId: context.tenantId,
          representativeUserId,
          routeTemplateId: { not: null },
          planDate: {
            gte: monthStart(previousMonth),
            lt: monthStart(month),
          },
        },
        select: { planDate: true, routeTemplateId: true },
        orderBy: { planDate: "asc" },
      }),
      this.prisma.routePlan.findMany({
        where: {
          tenantId: context.tenantId,
          representativeUserId,
          planDate: {
            gte: monthStart(month),
            lt: monthStart(nextMonth),
          },
        },
        select: { planDate: true },
      }),
    ]);

    const occupiedDates = new Set(
      existingPlans.map((plan) => dateKey(plan.planDate)),
    );
    const templateIds = [
      ...new Set(
        sourcePlans
          .map((plan) => plan.routeTemplateId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const templates = await this.prisma.routeTemplate.findMany({
      where: { id: { in: templateIds }, tenantId: context.tenantId },
      include: routeTemplateInclude,
    });
    const templateById = new Map(templates.map((t) => [t.id, t]));

    let createdCount = 0;
    let skippedCount = 0;

    for (const sourcePlan of sourcePlans) {
      const targetDate = shiftDateToMonth(sourcePlan.planDate, month);

      if (!targetDate || !sourcePlan.routeTemplateId) {
        skippedCount += 1;
        continue;
      }

      if (occupiedDates.has(dateKey(targetDate))) {
        skippedCount += 1;
        continue;
      }

      const template = templateById.get(sourcePlan.routeTemplateId);

      if (!template) {
        skippedCount += 1;
        continue;
      }

      try {
        await this.materializeTemplateAssignment(
          context.tenantId,
          template,
          targetDate,
        );
        occupiedDates.add(dateKey(targetDate));
        createdCount += 1;
      } catch (error) {
        // A concurrent assign (another tab, a manager) can still take this
        // exact date between the occupied-dates snapshot above and this
        // create — treat it the same as any other already-planned day
        // instead of aborting the rest of the batch with a 409.
        if (error instanceof ConflictException) {
          skippedCount += 1;
          continue;
        }

        throw error;
      }
    }

    return { createdCount, skippedCount };
  }

  private async materializeTemplateAssignment(
    tenantId: string,
    template: RouteTemplateWithItems,
    planDate: Date,
  ): Promise<RoutePlanResponse> {
    // Assign/copy-month can run long after the template was created, so the
    // representative it targets might have since been deactivated — the
    // same check createRoutePlan/createRouteTemplate already do up front.
    await assertFieldRepresentative(
      this.prisma,
      tenantId,
      template.representativeUserId,
    );

    try {
      const plan = await this.prisma.$transaction(async (tx) => {
        const createdPlan = await tx.routePlan.create({
          data: {
            tenantId,
            representativeUserId: template.representativeUserId,
            planDate,
            routeTemplateId: template.id,
          },
        });

        if (template.items.length > 0) {
          await tx.routeItem.createMany({
            data: template.items.map((item) => ({
              tenantId,
              routePlanId: createdPlan.id,
              locationId: item.locationId,
              sequence: item.sequence,
            })),
          });
        }

        return tx.routePlan.findUniqueOrThrow({
          where: { id: createdPlan.id },
          include: routePlanInclude,
        });
      });

      return toRoutePlanResponse(plan);
    } catch (error) {
      // Guards against a duplicate assign racing this exact (rep, date) pair
      // in between the caller's own existence check and this create.
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

  private async findTenantRouteTemplate(
    context: RequestContext,
    templateId: string,
  ): Promise<RouteTemplateWithItems> {
    const template = await this.prisma.routeTemplate.findFirst({
      where: { id: templateId, tenantId: context.tenantId },
      include: routeTemplateInclude,
    });

    if (!template) {
      throw new NotFoundException({
        code: "ROUTE_TEMPLATE_NOT_FOUND",
        message: "Route template was not found.",
      });
    }

    assertCanManageRouteForRepresentative(
      context,
      template.representativeUserId,
    );

    return template;
  }

  private async getRouteTemplateResponse(
    templateId: string,
  ): Promise<RouteTemplateResponse> {
    const template = await this.prisma.routeTemplate.findUniqueOrThrow({
      where: { id: templateId },
      include: routeTemplateInclude,
    });

    return toRouteTemplateResponse(template);
  }

  private async findTenantRouteTemplateItem(
    tenantId: string,
    routeTemplateId: string,
    itemId: string,
  ) {
    const item = await this.prisma.routeTemplateItem.findFirst({
      where: {
        id: itemId,
        tenantId,
        routeTemplateId,
      },
    });

    if (!item) {
      throw new NotFoundException({
        code: "ROUTE_TEMPLATE_ITEM_NOT_FOUND",
        message: "Route template stop was not found.",
      });
    }

    return item;
  }
}

const routeTemplateInclude = {
  items: {
    include: {
      location: true,
    },
    orderBy: { sequence: "asc" },
  },
} satisfies Prisma.RouteTemplateInclude;

// The frontend computes the next sequence client-side (current max + 1), so
// two concurrent edits on the same route can race for the same slot; without
// this the unique (tenantId, routeTemplateId, sequence) index would surface
// as an unhandled 500 instead of a 409 the client can react to.
function toSequenceConflictOrRethrow(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return new ConflictException({
      code: "ROUTE_TEMPLATE_ITEM_SEQUENCE_TAKEN",
      message: "Another stop already uses that position in this route.",
    });
  }

  return error;
}

function toRouteTemplateResponse(
  template: RouteTemplateWithItems,
): RouteTemplateResponse {
  return {
    id: template.id,
    representativeUserId: template.representativeUserId,
    name: template.name,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    items: template.items.map((item) => ({
      id: item.id,
      locationId: item.locationId,
      location: {
        id: item.location.id,
        name: item.location.name,
        addressLine: item.location.addressLine,
        city: item.location.city,
      },
      sequence: item.sequence,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}

function normalizeTemplateName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

function normalizeDirection(value: unknown): "up" | "down" | null {
  return value === "up" || value === "down" ? value : null;
}

function normalizeMonth(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) {
    return null;
  }

  const monthNumber = Number(value.slice(5, 7));

  if (monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  return value;
}

function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const base = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));

  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Same day-of-month as `sourceDate`, moved into `targetMonth`; null if that
// day doesn't exist there (e.g. the 31st into a 30-day month).
function shiftDateToMonth(sourceDate: Date, targetMonth: string): Date | null {
  const [targetYear, targetMonthNumber] = targetMonth.split("-").map(Number);
  const day = sourceDate.getUTCDate();
  const candidate = new Date(Date.UTC(targetYear, targetMonthNumber - 1, day));

  if (
    candidate.getUTCFullYear() !== targetYear ||
    candidate.getUTCMonth() !== targetMonthNumber - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return candidate;
}
