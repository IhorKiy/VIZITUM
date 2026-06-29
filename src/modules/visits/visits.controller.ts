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
import type { CreateTranscriptionJobRequestBody } from "../ai/ai.types";
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
      status: parseVisitStatus(query.status),
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
