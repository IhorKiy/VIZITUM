import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, VisitStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  createPaginatedResponse,
  type PaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import { StorageService } from "../storage/storage.service";
import type { RequestContext } from "../tenancy/request-context";
import {
  extractTasksToCreate,
  findReportCreatedTasks,
  toReportResponse,
} from "./report-response.util";
import type {
  AddTextVisitNoteRequestBody,
  ConfirmReportRequestBody,
  CreateVisitRequestBody,
  ListVisitsQuery,
  RegisterAudioUploadRequestBody,
  RegisteredAudioUploadResponse,
  ReportResponse,
  UpdateVisitRequestBody,
  VisitNoteResponse,
  VisitResponse,
} from "./visits.types";

const TEMPORARY_AUDIO_TTL_HOURS = 24;
const MAX_TEMPORARY_AUDIO_SIZE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_AUDIO_CONTENT_TYPES = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/aac",
  "audio/mpeg",
  "audio/wav",
]);
const AUDIO_CONTENT_TYPE_ALIASES = new Map([
  ["audio/m4a", "audio/mp4"],
  ["audio/mp3", "audio/mpeg"],
  ["audio/wave", "audio/wav"],
  ["audio/x-m4a", "audio/mp4"],
  ["audio/x-wav", "audio/wav"],
  ["video/mp4", "audio/mp4"],
]);

type VisitWithRelations = Prisma.VisitGetPayload<{
  include: {
    location: true;
    representative: true;
  };
}>;

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService?: StorageService,
  ) {}

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

  async getVisitReport(
    context: RequestContext,
    visitId: string,
  ): Promise<ReportResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanReadReport(context, visit.representativeUserId);

    const report = await this.prisma.report.findFirst({
      where: {
        tenantId: context.tenantId,
        visitId: visit.id,
      },
    });

    if (!report) {
      throw new NotFoundException({
        code: "REPORT_NOT_FOUND",
        message: "Report was not found for this visit.",
      });
    }

    const createdTasks = await findReportCreatedTasks(
      this.prisma,
      context.tenantId,
      report.id,
    );

    return toReportResponse(report, createdTasks);
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

  async addTextNote(
    context: RequestContext,
    visitId: string,
    body: AddTextVisitNoteRequestBody,
  ): Promise<VisitNoteResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanUpdateVisit(context, visit.representativeUserId);

    const textContent = normalizeRequiredString(body.textContent);

    if (!textContent) {
      throw new BadRequestException({
        code: "VISIT_NOTE_INVALID",
        message: "Text content is required.",
        fieldErrors: {
          textContent: ["Text content is required."],
        },
      });
    }

    if (!context.userId) {
      throwMissingVisitPermission();
    }

    const note = await this.prisma.visitNote.create({
      data: {
        tenantId: context.tenantId,
        visitId: visit.id,
        inputType: "text",
        textContent,
        createdByUserId: context.userId,
      },
    });

    return toVisitNoteResponse(note);
  }

  async registerTemporaryAudioUpload(
    context: RequestContext,
    visitId: string,
    body: RegisterAudioUploadRequestBody,
  ): Promise<RegisteredAudioUploadResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanUpdateVisit(context, visit.representativeUserId);

    if (!context.userId) {
      throwMissingVisitPermission();
    }

    const fileName = normalizeAudioFileName(body.fileName);
    const contentType = normalizeAudioContentType(body.contentType, fileName);
    const sizeBytes = normalizeAudioSizeBytes(body.sizeBytes);
    const checksum = normalizeOptionalString(body.checksum);

    if (!fileName || !contentType) {
      throw new BadRequestException({
        code: "AUDIO_UPLOAD_INVALID",
        message: "Audio file name and supported content type are required.",
        fieldErrors: {
          fileName: fileName ? [] : ["File name is required."],
          contentType: contentType
            ? []
            : ["Supported audio content type is required."],
        },
      });
    }

    const expiresAt = new Date(
      Date.now() + TEMPORARY_AUDIO_TTL_HOURS * 60 * 60 * 1000,
    );
    const objectKey = buildTemporaryAudioObjectKey(
      context.tenantId,
      visit.id,
      fileName,
    );
    const createdByUserId = context.userId;

    const result = await this.prisma.$transaction(async (tx) => {
      const storageObject = await tx.storageObject.create({
        data: {
          tenantId: context.tenantId,
          bucket: this.storageService?.getDefaultBucket() ?? "vizitum",
          objectKey,
          purpose: "temporary_audio",
          contentType,
          sizeBytes: sizeBytes === null ? null : BigInt(sizeBytes),
          checksum,
          status: "active",
          expiresAt,
          createdByUserId,
        },
      });
      const note = await tx.visitNote.create({
        data: {
          tenantId: context.tenantId,
          visitId: visit.id,
          inputType: "audio",
          temporaryAudioObjectId: storageObject.id,
          createdByUserId,
        },
      });

      return { note, storageObject };
    });

    const uploadUrl = this.storageService
      ? await this.storageService.createPresignedUploadUrl(
          context,
          result.storageObject.id,
        )
      : undefined;

    return {
      note: toVisitNoteResponse(result.note),
      storageObject: {
        id: result.storageObject.id,
        bucket: result.storageObject.bucket,
        objectKey: result.storageObject.objectKey,
        contentType: result.storageObject.contentType,
        sizeBytes: result.storageObject.sizeBytes?.toString() ?? null,
        checksum: result.storageObject.checksum,
        expiresAt:
          result.storageObject.expiresAt?.toISOString() ??
          expiresAt.toISOString(),
      },
      ...(uploadUrl
        ? {
            uploadUrl: {
              url: uploadUrl.url,
              method: "PUT",
              expiresAt: uploadUrl.expiresAt,
              headers: uploadUrl.headers,
            },
          }
        : {}),
    };
  }

  async confirmReport(
    context: RequestContext,
    visitId: string,
    body: ConfirmReportRequestBody,
  ): Promise<ReportResponse> {
    if (!context.permissions.includes(PERMISSIONS.REPORTS_CONFIRM_OWN)) {
      throwMissingVisitPermission();
    }

    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanUpdateVisit(context, visit.representativeUserId);

    if (!context.userId) {
      throwMissingVisitPermission();
    }

    const confirmedByUserId = context.userId;
    const confirmedData = normalizeJsonObject(body.confirmedData);
    const schemaVersion =
      normalizeRequiredString(body.schemaVersion) ?? "manual.v1";

    if (!confirmedData) {
      throw new BadRequestException({
        code: "REPORT_INVALID",
        message: "Confirmed report data is required.",
        fieldErrors: {
          confirmedData: ["Confirmed report data must be a JSON object."],
        },
      });
    }

    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: context.tenantId },
      select: { segmentTemplate: true },
    });

    if (!tenant) {
      throw new BadRequestException({
        code: "TENANT_INVALID",
        message: "Tenant could not be resolved.",
      });
    }

    const report = await this.prisma.$transaction(async (tx) => {
      const confirmedAt = new Date();
      const result = await tx.report.upsert({
        where: { visitId: visit.id },
        create: {
          tenantId: context.tenantId,
          visitId: visit.id,
          locationId: visit.locationId,
          representativeUserId: visit.representativeUserId,
          templateCode: tenant.segmentTemplate,
          schemaVersion,
          status: "confirmed",
          confirmedData,
          confirmedByUserId,
          confirmedAt,
          aiMetadata: {
            source: "manual_text",
          },
        },
        update: {
          schemaVersion,
          status: "confirmed",
          confirmedData,
          confirmedByUserId,
          confirmedAt,
          aiMetadata: {
            source: "manual_text",
          },
        },
      });

      await tx.visit.update({
        where: { id: visit.id },
        data: {
          status: "completed",
          completedAt: visit.completedAt ?? confirmedAt,
        },
      });

      if (visit.routeItemId) {
        await tx.routeItem.update({
          where: { id: visit.routeItemId },
          data: { status: "visited" },
        });
      }

      // Same `confirmedData.tasksToCreate` contract as the AI-draft confirm
      // flow (ai.service.ts) — reused so the field-report form's "tasks for
      // the next visit" block creates real Task rows the same way. Only
      // touch tasks when the payload actually carries some: this keeps a
      // resubmit idempotent (old ones tied to this report are replaced)
      // without deleting anything for schemas that never set this field
      // (e.g. manual.v1).
      const tasksToCreate = extractTasksToCreate(confirmedData);

      if (tasksToCreate.length > 0) {
        await tx.task.deleteMany({
          where: {
            tenantId: context.tenantId,
            reportId: result.id,
          },
        });

        await tx.task.createMany({
          data: tasksToCreate.map((task) => ({
            tenantId: context.tenantId,
            title: task.title,
            description: task.description,
            priority: task.priority,
            assignedToUserId:
              task.assignee === "representative"
                ? visit.representativeUserId
                : null,
            createdByUserId: confirmedByUserId,
            locationId: visit.locationId,
            visitId: visit.id,
            reportId: result.id,
            dueDate: task.dueDate,
          })),
        });
      }

      return result;
    });

    const createdTasks = await findReportCreatedTasks(
      this.prisma,
      context.tenantId,
      report.id,
    );

    return toReportResponse(report, createdTasks);
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

  private assertCanReadReport(
    context: RequestContext,
    representativeUserId: string,
  ): void {
    if (context.permissions.includes(PERMISSIONS.REPORTS_READ_TEAM)) {
      return;
    }

    if (
      context.permissions.includes(PERMISSIONS.REPORTS_READ_OWN) &&
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
          tenantId,
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
  const canReadTeam = context.permissions.includes(
    PERMISSIONS.VISITS_READ_TEAM,
  );
  const canReadOwn = context.permissions.includes(PERMISSIONS.VISITS_READ_OWN);
  const representativeFilter = canReadTeam
    ? requestedRepresentativeId
    : canReadOwn
      ? context.userId
      : null;

  if (!canReadTeam && !representativeFilter) {
    throwMissingVisitPermission();
  }

  const startedAt = buildDateTimeRangeFilter(
    query.startedFrom,
    query.startedTo,
  );

  return {
    tenantId: context.tenantId,
    ...(representativeFilter
      ? { representativeUserId: representativeFilter }
      : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.routePlanId
      ? {
          routeItem: {
            tenantId: context.tenantId,
            routePlanId: query.routePlanId,
          },
        }
      : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(startedAt ? { startedAt } : {}),
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

function normalizeJsonObject(value: unknown): Prisma.InputJsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

function normalizeAudioFileName(value: unknown): string | null {
  const normalizedValue = normalizeRequiredString(value);

  if (!normalizedValue) {
    return null;
  }

  return (
    normalizedValue
      .replaceAll("\\", "/")
      .split("/")
      .at(-1)
      ?.replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120) || null
  );
}

function normalizeAudioContentType(
  value: unknown,
  fileName?: string | null,
): string | null {
  const normalizedValue = normalizeRequiredString(value)?.toLowerCase();
  const aliasedValue = normalizedValue
    ? (AUDIO_CONTENT_TYPE_ALIASES.get(normalizedValue) ?? normalizedValue)
    : null;

  if (aliasedValue && SUPPORTED_AUDIO_CONTENT_TYPES.has(aliasedValue)) {
    return aliasedValue;
  }

  return normalizeAudioContentTypeFromFileName(fileName);
}

function normalizeAudioContentTypeFromFileName(
  fileName: string | null | undefined,
): string | null {
  const extension = fileName?.split(".").pop()?.toLowerCase();

  if (extension === "mp3") {
    return "audio/mpeg";
  }

  if (extension === "m4a" || extension === "mp4" || extension === "aac") {
    return "audio/mp4";
  }

  if (extension === "wav") {
    return "audio/wav";
  }

  if (extension === "webm") {
    return "audio/webm";
  }

  return null;
}

function normalizeAudioSizeBytes(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsedValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue <= 0 ||
    parsedValue > MAX_TEMPORARY_AUDIO_SIZE_BYTES
  ) {
    throw new BadRequestException({
      code: "AUDIO_UPLOAD_SIZE_INVALID",
      message: "Audio size must be a positive integer up to 50 MB.",
      fieldErrors: {
        sizeBytes: ["Audio size must be a positive integer up to 50 MB."],
      },
    });
  }

  return parsedValue;
}

function buildTemporaryAudioObjectKey(
  tenantId: string,
  visitId: string,
  fileName: string,
): string {
  return [
    "tenants",
    tenantId,
    "visits",
    visitId,
    "audio",
    randomUUID(),
    fileName,
  ].join("/");
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

function buildDateTimeRangeFilter(
  fromValue: unknown,
  toValue: unknown,
): Prisma.DateTimeNullableFilter | undefined {
  const gte = parseDateOnlyBoundary(fromValue, "start");
  const lte = parseDateOnlyBoundary(toValue, "end");

  if (!gte && !lte) {
    return undefined;
  }

  return {
    ...(gte ? { gte } : {}),
    ...(lte ? { lte } : {}),
  };
}

function parseDateOnlyBoundary(
  value: unknown,
  boundary: "start" | "end",
): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException({
      code: "DATE_INVALID",
      message: "Date filters must use YYYY-MM-DD format.",
    });
  }

  const suffix = boundary === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
  const date = new Date(`${value}${suffix}`);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      code: "DATE_INVALID",
      message: "Date filters must use YYYY-MM-DD format.",
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

function toVisitNoteResponse(note: {
  id: string;
  visitId: string;
  inputType: "text" | "audio";
  textContent: string | null;
  temporaryAudioObjectId?: string | null;
  createdByUserId: string;
  createdAt: Date;
}): VisitNoteResponse {
  return {
    id: note.id,
    visitId: note.visitId,
    inputType: note.inputType,
    textContent: note.textContent,
    temporaryAudioObjectId: note.temporaryAudioObjectId ?? null,
    createdByUserId: note.createdByUserId,
    createdAt: note.createdAt.toISOString(),
  };
}

function throwMissingVisitPermission(): never {
  throw new ForbiddenException({
    code: "VISIT_SCOPE_FORBIDDEN",
    message: "You cannot access this visit.",
  });
}
