import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { VisitStatus } from "@prisma/client";
import type { Request } from "express";

import { AiService } from "../ai/ai.service";
import type {
  ConfirmAiDraftRequestBody,
  CreateExtractionJobRequestBody,
  CreateTranscriptionJobRequestBody,
  FieldReportProductCatalogEntry,
  TranscribeFieldReportRequestBody,
} from "../ai/ai.types";
import { PermissionGuard } from "../auth/permission.guard";
import {
  RequireAnyPermissions,
  RequirePermissions,
} from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { VisitsService } from "./visits.service";
import type {
  AddTextVisitNoteRequestBody,
  ConfirmReportRequestBody,
  CreateVisitRequestBody,
  RegisterAudioUploadRequestBody,
  UpdateVisitRequestBody,
} from "./visits.types";

@Controller("visits")
@UseGuards(PermissionGuard)
export class VisitsController {
  constructor(
    private readonly visitsService: VisitsService,
    private readonly aiService: AiService,
  ) {}

  @Get()
  @RequireAnyPermissions(
    PERMISSIONS.VISITS_READ_OWN,
    PERMISSIONS.VISITS_READ_TEAM,
  )
  listVisits(@Req() request: Request, @Query() query: Record<string, string>) {
    return this.visitsService.listVisits(getRequestContext(request), {
      page: parsePositiveInteger(query.page),
      pageSize: parsePositiveInteger(query.pageSize),
      representativeUserId: normalizeQueryString(query.representativeUserId),
      locationId: normalizeQueryString(query.locationId),
      routePlanId: normalizeQueryString(query.routePlanId),
      status: parseVisitStatusList(query.status),
      startedFrom: normalizeQueryString(query.startedFrom),
      startedTo: normalizeQueryString(query.startedTo),
    });
  }

  @Get(":visitId")
  @RequireAnyPermissions(
    PERMISSIONS.VISITS_READ_OWN,
    PERMISSIONS.VISITS_READ_TEAM,
  )
  getVisit(@Req() request: Request, @Param("visitId") visitId: string) {
    return this.visitsService.getVisit(getRequestContext(request), visitId);
  }

  @Get(":visitId/report")
  @RequireAnyPermissions(
    PERMISSIONS.REPORTS_READ_OWN,
    PERMISSIONS.REPORTS_READ_TEAM,
  )
  getVisitReport(@Req() request: Request, @Param("visitId") visitId: string) {
    return this.visitsService.getVisitReport(
      getRequestContext(request),
      visitId,
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.VISITS_CREATE)
  createVisit(@Req() request: Request, @Body() body: CreateVisitRequestBody) {
    return this.visitsService.createVisit(getRequestContext(request), body);
  }

  @Patch(":visitId")
  @RequirePermissions(PERMISSIONS.VISITS_UPDATE_OWN)
  updateVisit(
    @Req() request: Request,
    @Param("visitId") visitId: string,
    @Body() body: UpdateVisitRequestBody,
  ) {
    return this.visitsService.updateVisit(
      getRequestContext(request),
      visitId,
      body,
    );
  }

  @Post(":visitId/notes/text")
  @RequirePermissions(PERMISSIONS.VISITS_UPDATE_OWN)
  addTextNote(
    @Req() request: Request,
    @Param("visitId") visitId: string,
    @Body() body: AddTextVisitNoteRequestBody,
  ) {
    return this.visitsService.addTextNote(
      getRequestContext(request),
      visitId,
      body,
    );
  }

  @Post(":visitId/notes/audio/register")
  @RequirePermissions(PERMISSIONS.VISITS_UPDATE_OWN)
  registerTemporaryAudioUpload(
    @Req() request: Request,
    @Param("visitId") visitId: string,
    @Body() body: RegisterAudioUploadRequestBody,
  ) {
    return this.visitsService.registerTemporaryAudioUpload(
      getRequestContext(request),
      visitId,
      body,
    );
  }

  @Post(":visitId/ai/transcription-jobs")
  @RequirePermissions(
    PERMISSIONS.VISITS_UPDATE_OWN,
    PERMISSIONS.AI_USE_REPORTING,
  )
  createTranscriptionJob(
    @Req() request: Request,
    @Param("visitId") visitId: string,
    @Body() body: CreateTranscriptionJobRequestBody,
  ) {
    return this.aiService.createTranscriptionJob(
      getRequestContext(request),
      visitId,
      parseRequiredBodyString(body.inputObjectId, "inputObjectId"),
    );
  }

  @Post(":visitId/ai/extraction-jobs")
  @RequirePermissions(
    PERMISSIONS.VISITS_UPDATE_OWN,
    PERMISSIONS.AI_USE_REPORTING,
  )
  createExtractionJob(
    @Req() request: Request,
    @Param("visitId") visitId: string,
    @Body() body: CreateExtractionJobRequestBody,
  ) {
    return this.aiService.createExtractionJob(
      getRequestContext(request),
      visitId,
      parseRequiredBodyString(body.transcriptionJobId, "transcriptionJobId"),
    );
  }

  @Post(":visitId/ai/drafts/confirm")
  @RequirePermissions(
    PERMISSIONS.VISITS_UPDATE_OWN,
    PERMISSIONS.AI_USE_REPORTING,
    PERMISSIONS.REPORTS_CONFIRM_OWN,
  )
  confirmAiDraft(
    @Req() request: Request,
    @Param("visitId") visitId: string,
    @Body() body: ConfirmAiDraftRequestBody,
  ) {
    return this.aiService.confirmAiDraft(
      getRequestContext(request),
      visitId,
      parseRequiredBodyString(body.extractionJobId, "extractionJobId"),
      body.confirmedData,
    );
  }

  @Post(":visitId/ai/field-report-transcriptions")
  @RequirePermissions(
    PERMISSIONS.VISITS_UPDATE_OWN,
    PERMISSIONS.AI_USE_REPORTING,
  )
  transcribeFieldReport(
    @Req() request: Request,
    @Param("visitId") visitId: string,
    @Body() body: TranscribeFieldReportRequestBody,
  ) {
    return this.aiService.transcribeFieldReport(
      getRequestContext(request),
      visitId,
      {
        audioObjectId: parseRequiredBodyString(
          body.audioObjectId,
          "audioObjectId",
        ),
        products: parseProductCatalog(body.products),
      },
    );
  }

  @Post(":visitId/reports/confirm")
  @RequirePermissions(PERMISSIONS.REPORTS_CONFIRM_OWN)
  confirmReport(
    @Req() request: Request,
    @Param("visitId") visitId: string,
    @Body() body: ConfirmReportRequestBody,
  ) {
    return this.visitsService.confirmReport(
      getRequestContext(request),
      visitId,
      body,
    );
  }
}

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : undefined;
}

// Accepts either a single status or a comma-separated list (e.g.
// `status=draft,in_progress`) so a caller like the field history "needs
// follow-up" counter can filter on several statuses in one request instead of
// summing several single-status requests. Unknown tokens are dropped rather
// than rejected, same as a single unknown value always has been.
function parseVisitStatusList(
  value: string | undefined,
): VisitStatus[] | undefined {
  if (!value) {
    return undefined;
  }

  const statuses = new Set<VisitStatus>();

  for (const rawStatus of value.split(",")) {
    const status = parseVisitStatus(rawStatus.trim());

    if (status) {
      statuses.add(status);
    }
  }

  return statuses.size > 0 ? [...statuses] : undefined;
}

function parseVisitStatus(value: string | undefined): VisitStatus | undefined {
  if (
    value === "draft" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return undefined;
}

function normalizeQueryString(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();

  return normalizedValue || undefined;
}

function parseProductCatalog(value: unknown): FieldReportProductCatalogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): FieldReportProductCatalogEntry[] => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as Record<string, unknown>).id !== "string" ||
      typeof (item as Record<string, unknown>).name !== "string"
    ) {
      return [];
    }

    const row = item as Record<string, unknown>;

    return [
      {
        id: row.id as string,
        name: row.name as string,
        sku: typeof row.sku === "string" ? row.sku : null,
        category: typeof row.category === "string" ? row.category : null,
      },
    ];
  });
}

function parseRequiredBodyString(value: unknown, fieldName: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  throw new BadRequestException({
    code: "REQUEST_BODY_INVALID",
    message: `${fieldName} is required.`,
    fieldErrors: {
      [fieldName]: [`${fieldName} is required.`],
    },
  });
}
