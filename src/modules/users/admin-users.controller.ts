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
import { PERMISSIONS } from "../roles/permissions";
import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import type { RequestContext } from "../tenancy/request-context";
import { AddUserRoleDto, InviteUserDto, UpdateUserDto } from "./users.dto";
import { UsersService } from "./users.service";

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
  // Tier 4 (administrative surfaces) of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  inviteUser(@Req() request: Request, @Body() body: InviteUserDto) {
    return this.usersService.inviteUser(getRequestContext(request), body);
  }

  @Get("invites")
  @RequirePermissions(PERMISSIONS.USERS_READ)
  listInvites(@Req() request: Request) {
    return this.usersService.listInvites(getRequestContext(request));
  }

  @Post("invites/:inviteId/resend")
  @RequirePermissions(PERMISSIONS.USERS_INVITE)
  resendInvite(@Req() request: Request, @Param("inviteId") inviteId: string) {
    return this.usersService.resendInvite(getRequestContext(request), inviteId);
  }

  @Patch(":userId")
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  updateUser(
    @Req() request: Request,
    @Param("userId") userId: string,
    @Body() body: UpdateUserDto,
  ) {
    return this.usersService.updateUser(
      getRequestContext(request),
      userId,
      body,
    );
  }

  @Post(":userId/roles")
  @RequirePermissions(PERMISSIONS.ROLES_ASSIGN)
  @UsePipes(createStrictValidationPipe())
  addRole(
    @Req() request: Request,
    @Param("userId") userId: string,
    @Body() body: AddUserRoleDto,
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

  @Delete(":userId")
  @RequirePermissions(PERMISSIONS.ADMINS_MANAGE)
  deleteUser(@Req() request: Request, @Param("userId") userId: string) {
    return this.usersService.deleteUser(getRequestContext(request), userId);
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
