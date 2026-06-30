import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequireAnyPermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { normalizeSignedUrlTtl, StorageService } from "./storage.service";
import type {
  CreatePresignedDownloadUrlRequestBody,
  CreatePresignedUploadUrlRequestBody,
} from "./storage.types";

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
  createPresignedUploadUrl(
    @Req() request: Request,
    @Param("storageObjectId") storageObjectId: string,
    @Body() body: CreatePresignedUploadUrlRequestBody,
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
  createPresignedDownloadUrl(
    @Req() request: Request,
    @Param("storageObjectId") storageObjectId: string,
    @Body() body: CreatePresignedDownloadUrlRequestBody,
  ) {
    return this.storageService.createPresignedDownloadUrl(
      getRequestContext(request),
      storageObjectId,
      normalizeSignedUrlTtl(body.expiresInSeconds),
    );
  }
}

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}
