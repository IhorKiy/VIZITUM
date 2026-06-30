import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import { OperationsService } from "./operations.service";

@Controller("operations")
@UseGuards(PermissionGuard)
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get("summary")
  @RequirePermissions(PERMISSIONS.PLATFORM_OPERATIONS_READ)
  async getSummary(@Req() request: Request) {
    const summary = await this.operationsService.getSummary();

    return {
      ...summary,
      requestId: request.requestId,
    };
  }
}
