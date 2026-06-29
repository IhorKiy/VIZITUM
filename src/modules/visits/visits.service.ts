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
import type { RequestContext } from "../tenancy/request-context";
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
    const contentType = normalizeAudioContentType(body.contentType);
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
          bucket: process.env.S3_BUCKET || "vizitum",
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

      return result;
    });

    return toReportResponse(report);
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

  return normalizedValue
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120) || null;
}

function normalizeAudioContentType(value: unknown): string | null {
  const normalizedValue = normalizeRequiredString(value)?.toLowerCase();

  if (
    !normalizedValue ||
    !SUPPORTED_AUDIO_CONTENT_TYPES.has(normalizedValue)
  ) {
    return null;
  }

  return normalizedValue;
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

function toReportResponse(report: {
  id: string;
  visitId: string;
  locationId: string;
  representativeUserId: string;
  templateCode: string;
  schemaVersion: string;
  status: string;
  confirmedData: unknown;
  confirmedByUserId: string;
  confirmedAt: Date;
  aiMetadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ReportResponse {
  return {
    id: report.id,
    visitId: report.visitId,
    locationId: report.locationId,
    representativeUserId: report.representativeUserId,
    templateCode: report.templateCode,
    schemaVersion: report.schemaVersion,
    status: report.status,
    confirmedData: report.confirmedData,
    confirmedByUserId: report.confirmedByUserId,
    confirmedAt: report.confirmedAt.toISOString(),
    aiMetadata: report.aiMetadata,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

function throwMissingVisitPermission(): never {
  throw new ForbiddenException({
    code: "VISIT_SCOPE_FORBIDDEN",
    message: "You cannot access this visit.",
  });
}
