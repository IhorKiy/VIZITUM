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
import type { ChainStatus } from "@prisma/client";
import type { Request } from "express";

import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import { getRequestContext } from "../tenancy/request-context";
import { CreateChainDto, UpdateChainDto } from "./chains.dto";
import { ChainsService } from "./chains.service";

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
  // Flat-CRUD tier of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  createChain(@Req() request: Request, @Body() body: CreateChainDto) {
    return this.chainsService.createChain(getRequestContext(request), body);
  }

  @Patch(":chainId")
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  updateChain(
    @Req() request: Request,
    @Param("chainId") chainId: string,
    @Body() body: UpdateChainDto,
  ) {
    return this.chainsService.updateChain(
      getRequestContext(request),
      chainId,
      body,
    );
  }
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
