import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";

import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { PermissionGuard } from "../auth/permission.guard";
import { RequireAnyPermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import { getRequestContext } from "../tenancy/request-context";
import { CreatePresignedUrlDto } from "./storage.dto";
import { normalizeSignedUrlTtl, StorageService } from "./storage.service";

@Controller("storage/objects")
@UseGuards(PermissionGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get(":storageObjectId")
  @RequireAnyPermissions(
    PERMISSIONS.VISITS_READ_OWN,
    PERMISSIONS.VISITS_READ_TEAM,
    PERMISSIONS.IMPORTS_READ,
  )
  getStorageObject(
    @Req() request: Request,
    @Param("storageObjectId") storageObjectId: string,
  ) {
    return this.storageService.getStorageObject(
      getRequestContext(request),
      storageObjectId,
    );
  }

  @Post(":storageObjectId/upload-url")
  @RequireAnyPermissions(
    PERMISSIONS.VISITS_UPDATE_OWN,
    PERMISSIONS.IMPORTS_UPLOAD,
  )
  // Tier 4 (administrative surfaces) of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  createPresignedUploadUrl(
    @Req() request: Request,
    @Param("storageObjectId") storageObjectId: string,
    @Body() body: CreatePresignedUrlDto,
  ) {
    return this.storageService.createPresignedUploadUrl(
      getRequestContext(request),
      storageObjectId,
      normalizeSignedUrlTtl(body.expiresInSeconds),
    );
  }

  @Post(":storageObjectId/download-url")
  @RequireAnyPermissions(
    PERMISSIONS.VISITS_READ_OWN,
    PERMISSIONS.VISITS_READ_TEAM,
    PERMISSIONS.IMPORTS_READ,
  )
  @UsePipes(createStrictValidationPipe())
  createPresignedDownloadUrl(
    @Req() request: Request,
    @Param("storageObjectId") storageObjectId: string,
    @Body() body: CreatePresignedUrlDto,
  ) {
    return this.storageService.createPresignedDownloadUrl(
      getRequestContext(request),
      storageObjectId,
      normalizeSignedUrlTtl(body.expiresInSeconds),
    );
  }
}
