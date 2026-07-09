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
} from "@nestjs/common";
import type { ChainStatus } from "@prisma/client";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { ChainsService } from "./chains.service";
import type {
  CreateChainRequestBody,
  UpdateChainRequestBody,
} from "./chains.types";

@Controller("chains")
@UseGuards(PermissionGuard)
export class ChainsController {
  constructor(private readonly chainsService: ChainsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LOCATIONS_READ)
  listChains(@Req() request: Request, @Query() query: Record<string, string>) {
    return this.chainsService.listChains(getRequestContext(request), {
      page: parsePositiveInteger(query.page),
      pageSize: parsePositiveInteger(query.pageSize),
      status: parseChainStatus(query.status),
      search: normalizeQueryString(query.search),
    });
  }

  @Get(":chainId")
  @RequirePermissions(PERMISSIONS.LOCATIONS_READ)
  getChain(@Req() request: Request, @Param("chainId") chainId: string) {
    return this.chainsService.getChain(getRequestContext(request), chainId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  createChain(@Req() request: Request, @Body() body: CreateChainRequestBody) {
    return this.chainsService.createChain(getRequestContext(request), body);
  }

  @Patch(":chainId")
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  updateChain(
    @Req() request: Request,
    @Param("chainId") chainId: string,
    @Body() body: UpdateChainRequestBody,
  ) {
    return this.chainsService.updateChain(
      getRequestContext(request),
      chainId,
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

function parseChainStatus(value: string | undefined): ChainStatus | undefined {
  if (value === "active" || value === "archived") {
    return value;
  }

  return undefined;
}

function normalizeQueryString(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();

  return normalizedValue || undefined;
}
