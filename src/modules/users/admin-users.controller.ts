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

import { PERMISSIONS } from "../roles/permissions";
import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import type { RequestContext } from "../tenancy/request-context";
import { UsersService } from "./users.service";
import type {
  AddUserRoleRequestBody,
  InviteUserRequestBody,
  UpdateUserRequestBody,
} from "./users.types";

@Controller("admin/users")
@UseGuards(PermissionGuard)
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  listUsers(@Req() request: Request, @Query() query: Record<string, string>) {
    return this.usersService.listUsers(getRequestContext(request), {
      page: parsePositiveInteger(query.page),
      pageSize: parsePositiveInteger(query.pageSize),
    });
  }

  @Post("invite")
  @RequirePermissions(PERMISSIONS.USERS_INVITE)
  inviteUser(@Req() request: Request, @Body() body: InviteUserRequestBody) {
    return this.usersService.inviteUser(getRequestContext(request), body);
  }

  @Patch(":userId")
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  updateUser(
    @Req() request: Request,
    @Param("userId") userId: string,
    @Body() body: UpdateUserRequestBody,
  ) {
    return this.usersService.updateUser(
      getRequestContext(request),
      userId,
      body,
    );
  }

  @Post(":userId/roles")
  @RequirePermissions(PERMISSIONS.ROLES_ASSIGN)
  addRole(
    @Req() request: Request,
    @Param("userId") userId: string,
    @Body() body: AddUserRoleRequestBody,
  ) {
    return this.usersService.addRole(getRequestContext(request), userId, body);
  }

  @Delete(":userId/roles/:roleCode")
  @RequirePermissions(PERMISSIONS.ROLES_ASSIGN)
  removeRole(
    @Req() request: Request,
    @Param("userId") userId: string,
    @Param("roleCode") roleCode: string,
  ) {
    return this.usersService.removeRole(
      getRequestContext(request),
      userId,
      roleCode,
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
