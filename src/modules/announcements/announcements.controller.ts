import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";

import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import { getRequestContext } from "../tenancy/request-context";
import { UpsertAnnouncementDto } from "./announcements.dto";
import { AnnouncementsService } from "./announcements.service";
import type { AnnouncementState } from "./announcements.types";

@Controller("announcements")
@UseGuards(PermissionGuard)
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  // The manager's board: every announcement the tenant has ever published,
  // whatever state it is in, with the read tally that says whether it landed.
  @Get()
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  listAnnouncements(
    @Req() request: Request,
    @Query() query: Record<string, string>,
  ) {
    return this.announcementsService.listAnnouncements(
      getRequestContext(request),
      {
        page: parsePositiveInteger(query.page),
        pageSize: parsePositiveInteger(query.pageSize),
        state: parseAnnouncementState(query.state),
      },
    );
  }

  // The representative's board: only what is in force today, unpaginated.
  @Get("active")
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_READ)
  listActiveAnnouncements(@Req() request: Request) {
    return this.announcementsService.listActiveAnnouncements(
      getRequestContext(request),
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  // Flat-CRUD tier of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  createAnnouncement(
    @Req() request: Request,
    @Body() body: UpsertAnnouncementDto,
  ) {
    return this.announcementsService.createAnnouncement(
      getRequestContext(request),
      body,
    );
  }

  @Patch(":announcementId")
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  updateAnnouncement(
    @Req() request: Request,
    @Param("announcementId") announcementId: string,
    @Body() body: UpsertAnnouncementDto,
  ) {
    return this.announcementsService.updateAnnouncement(
      getRequestContext(request),
      announcementId,
      body,
    );
  }

  // Withdrawal is a state change, not a delete: an announcement that was live
  // stays on the manager's board with its read tally intact.
  @Post(":announcementId/archive")
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  archiveAnnouncement(
    @Req() request: Request,
    @Param("announcementId") announcementId: string,
  ) {
    return this.announcementsService.archiveAnnouncement(
      getRequestContext(request),
      announcementId,
    );
  }

  @Post(":announcementId/read")
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_READ)
  markAnnouncementRead(
    @Req() request: Request,
    @Param("announcementId") announcementId: string,
  ) {
    return this.announcementsService.markAnnouncementRead(
      getRequestContext(request),
      announcementId,
    );
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : undefined;
}

function parseAnnouncementState(
  value: string | undefined,
): AnnouncementState | undefined {
  if (
    value === "scheduled" ||
    value === "active" ||
    value === "finished" ||
    value === "archived"
  ) {
    return value;
  }
  return undefined;
}
