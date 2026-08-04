import {
  Body,
  Controller,
  Delete,
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
import {
  RequireAnyPermissions,
  RequirePermissions,
} from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import {
  AssignRouteTemplateDto,
  CopyRoutePlansDto,
  CreateRouteTemplateDto,
  MoveRouteTemplateItemDto,
  ReorderRouteTemplateItemsDto,
  UpdateRouteTemplateDto,
  UpsertRouteTemplateItemDto,
} from "./route-templates.dto";
import { RouteTemplatesService } from "./route-templates.service";

@Controller("routes/templates")
@UseGuards(PermissionGuard)
export class RouteTemplatesController {
  constructor(private readonly routeTemplatesService: RouteTemplatesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROUTES_READ)
  listRouteTemplates(
    @Req() request: Request,
    @Query() query: Record<string, string>,
  ) {
    return this.routeTemplatesService.listRouteTemplates(
      getRequestContext(request),
      {
        page: parsePositiveInteger(query.page),
        pageSize: parsePositiveInteger(query.pageSize),
        representativeUserId: normalizeQueryString(query.representativeUserId),
      },
    );
  }

  @Get(":templateId")
  @RequirePermissions(PERMISSIONS.ROUTES_READ)
  getRouteTemplate(
    @Req() request: Request,
    @Param("templateId") templateId: string,
  ) {
    return this.routeTemplatesService.getRouteTemplate(
      getRequestContext(request),
      templateId,
    );
  }

  @Post()
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  // Tier 3 of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  createRouteTemplate(
    @Req() request: Request,
    @Body() body: CreateRouteTemplateDto,
  ) {
    return this.routeTemplatesService.createRouteTemplate(
      getRequestContext(request),
      body,
    );
  }

  @Post("copy-month")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  copyRoutePlans(@Req() request: Request, @Body() body: CopyRoutePlansDto) {
    return this.routeTemplatesService.copyRoutePlans(
      getRequestContext(request),
      body,
    );
  }

  @Patch(":templateId")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  updateRouteTemplate(
    @Req() request: Request,
    @Param("templateId") templateId: string,
    @Body() body: UpdateRouteTemplateDto,
  ) {
    return this.routeTemplatesService.updateRouteTemplate(
      getRequestContext(request),
      templateId,
      body,
    );
  }

  @Delete(":templateId")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  deleteRouteTemplate(
    @Req() request: Request,
    @Param("templateId") templateId: string,
  ) {
    return this.routeTemplatesService.deleteRouteTemplate(
      getRequestContext(request),
      templateId,
    );
  }

  @Post(":templateId/items")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  createRouteTemplateItem(
    @Req() request: Request,
    @Param("templateId") templateId: string,
    @Body() body: UpsertRouteTemplateItemDto,
  ) {
    return this.routeTemplatesService.createRouteTemplateItem(
      getRequestContext(request),
      templateId,
      body,
    );
  }

  @Patch(":templateId/items/:itemId")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  updateRouteTemplateItem(
    @Req() request: Request,
    @Param("templateId") templateId: string,
    @Param("itemId") itemId: string,
    @Body() body: UpsertRouteTemplateItemDto,
  ) {
    return this.routeTemplatesService.updateRouteTemplateItem(
      getRequestContext(request),
      templateId,
      itemId,
      body,
    );
  }

  @Post(":templateId/items/reorder")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  reorderRouteTemplateItems(
    @Req() request: Request,
    @Param("templateId") templateId: string,
    @Body() body: ReorderRouteTemplateItemsDto,
  ) {
    return this.routeTemplatesService.reorderRouteTemplateItems(
      getRequestContext(request),
      templateId,
      body,
    );
  }

  @Post(":templateId/items/:itemId/move")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  moveRouteTemplateItem(
    @Req() request: Request,
    @Param("templateId") templateId: string,
    @Param("itemId") itemId: string,
    @Body() body: MoveRouteTemplateItemDto,
  ) {
    return this.routeTemplatesService.moveRouteTemplateItem(
      getRequestContext(request),
      templateId,
      itemId,
      body,
    );
  }

  @Delete(":templateId/items/:itemId")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  deleteRouteTemplateItem(
    @Req() request: Request,
    @Param("templateId") templateId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.routeTemplatesService.deleteRouteTemplateItem(
      getRequestContext(request),
      templateId,
      itemId,
    );
  }

  @Post(":templateId/assign")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  assignRouteTemplate(
    @Req() request: Request,
    @Param("templateId") templateId: string,
    @Body() body: AssignRouteTemplateDto,
  ) {
    return this.routeTemplatesService.assignRouteTemplate(
      getRequestContext(request),
      templateId,
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

function normalizeQueryString(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();

  return normalizedValue || undefined;
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
