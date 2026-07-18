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
} from "@nestjs/common";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import {
  RequireAnyPermissions,
  RequirePermissions,
} from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { RouteTemplatesService } from "./route-templates.service";
import type {
  AssignRouteTemplateRequestBody,
  CopyRouteTemplatePlansRequestBody,
  CreateRouteTemplateItemRequestBody,
  CreateRouteTemplateRequestBody,
  UpdateRouteTemplateItemRequestBody,
  UpdateRouteTemplateRequestBody,
} from "./routes.types";

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
        representativeUserId: normalizeQueryString(query.representativeUserId),
      },
    );
  }

  @Post()
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  createRouteTemplate(
    @Req() request: Request,
    @Body() body: CreateRouteTemplateRequestBody,
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
  copyRoutePlans(
    @Req() request: Request,
    @Body() body: CopyRouteTemplatePlansRequestBody,
  ) {
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
  updateRouteTemplate(
    @Req() request: Request,
    @Param("templateId") templateId: string,
    @Body() body: UpdateRouteTemplateRequestBody,
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
  createRouteTemplateItem(
    @Req() request: Request,
    @Param("templateId") templateId: string,
    @Body() body: CreateRouteTemplateItemRequestBody,
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
  updateRouteTemplateItem(
    @Req() request: Request,
    @Param("templateId") templateId: string,
    @Param("itemId") itemId: string,
    @Body() body: UpdateRouteTemplateItemRequestBody,
  ) {
    return this.routeTemplatesService.updateRouteTemplateItem(
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
  assignRouteTemplate(
    @Req() request: Request,
    @Param("templateId") templateId: string,
    @Body() body: AssignRouteTemplateRequestBody,
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
