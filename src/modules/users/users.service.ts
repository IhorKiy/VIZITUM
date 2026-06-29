import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { RoleCode, User, UserRole, UserStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";

import {
  createPaginatedResponse,
  type PaginatedResponse,
  type PaginationInput,
  resolvePagination,
} from "../../common/pagination";
import { hashValue } from "../auth/auth-crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type {
  AddUserRoleRequestBody,
  InviteUserRequestBody,
  InviteUserResponse,
  UpdateUserRequestBody,
  UserResponse,
} from "./users.types";

const INVITE_TOKEN_BYTES = 32;
const INVITE_TTL_DAYS = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

type UserWithRoles = User & { roles: UserRole[] };

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(
    context: RequestContext,
    paginationInput: PaginationInput,
  ): Promise<PaginatedResponse<UserResponse>> {
    const pagination = resolvePagination(paginationInput);
    const where = {
      tenantId: context.tenantId,
      deletedAt: null,
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { roles: true },
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return createPaginatedResponse(
      users.map(toUserResponse),
      pagination,
      total,
    );
  }

  async inviteUser(
    context: RequestContext,
    body: InviteUserRequestBody,
  ): Promise<InviteUserResponse> {
    const email = normalizeEmail(body.email);
    const roleCodes = normalizeRoleCodes(body.roleCodes);

    if (!email || !roleCodes.length) {
      throw new BadRequestException({
        code: "INVITE_INVALID",
        message: "Email and at least one valid role are required.",
        fieldErrors: {
          email: email ? [] : ["Email is required."],
          roleCodes: roleCodes.length
            ? []
            : ["At least one valid role is required."],
        },
      });
    }

    const existingUser = await this.prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: context.tenantId,
          email,
        },
      },
      select: { id: true, deletedAt: true },
    });

    if (existingUser && !existingUser.deletedAt) {
      throw new ConflictException({
        code: "USER_ALREADY_EXISTS",
        message: "User already exists in this tenant.",
        fieldErrors: {
          email: ["User already exists in this tenant."],
        },
      });
    }

    const token = randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(
      Date.now() + INVITE_TTL_DAYS * MILLISECONDS_PER_DAY,
    );

    const invite = await this.prisma.invite.create({
      data: {
        tenantId: context.tenantId,
        email,
        roleCodes,
        tokenHash: hashValue(token),
        expiresAt,
        createdByUserId: context.userId,
      },
    });

    return {
      id: invite.id,
      email: invite.email,
      roleCodes: invite.roleCodes,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      token,
    };
  }

  async updateUser(
    context: RequestContext,
    userId: string,
    body: UpdateUserRequestBody,
  ): Promise<UserResponse> {
    const user = await this.findTenantUser(context.tenantId, userId);
    const status = normalizeUserStatus(body.status);

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(typeof body.name === "string" && body.name.trim()
          ? { name: body.name.trim() }
          : {}),
        ...(body.phone === null || typeof body.phone === "string"
          ? { phone: normalizeOptionalString(body.phone) }
          : {}),
        ...(status ? { status } : {}),
      },
      include: { roles: true },
    });

    return toUserResponse(updatedUser);
  }

  async addRole(
    context: RequestContext,
    userId: string,
    body: AddUserRoleRequestBody,
  ): Promise<UserResponse> {
    const roleCode = normalizeRoleCode(body.roleCode);

    if (!roleCode) {
      throwInvalidRole();
    }

    const user = await this.findTenantUser(context.tenantId, userId);

    await this.prisma.userRole.upsert({
      where: {
        tenantId_userId_roleCode: {
          tenantId: context.tenantId,
          userId: user.id,
          roleCode,
        },
      },
      create: {
        tenantId: context.tenantId,
        userId: user.id,
        roleCode,
        assignedByUserId: context.userId,
      },
      update: {},
    });

    return this.getUserResponse(context.tenantId, user.id);
  }

  async removeRole(
    context: RequestContext,
    userId: string,
    roleCodeInput: string,
  ): Promise<UserResponse> {
    const roleCode = normalizeRoleCode(roleCodeInput);

    if (!roleCode) {
      throwInvalidRole();
    }

    const user = await this.findTenantUser(context.tenantId, userId);

    await this.prisma.userRole.deleteMany({
      where: {
        tenantId: context.tenantId,
        userId: user.id,
        roleCode,
      },
    });

    return this.getUserResponse(context.tenantId, user.id);
  }

  private async getUserResponse(
    tenantId: string,
    userId: string,
  ): Promise<UserResponse> {
    const user = await this.findTenantUser(tenantId, userId);

    return toUserResponse(user);
  }

  private async findTenantUser(
    tenantId: string,
    userId: string,
  ): Promise<UserWithRoles> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
      },
      include: { roles: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "User was not found.",
      });
    }

    return user;
  }
}

function toUserResponse(user: UserWithRoles): UserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    status: user.status,
    lastSelectedRoleCode: user.lastSelectedRoleCode,
    roleCodes: user.roles.map((role) => role.roleCode),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();

  return email || null;
}

function normalizeRoleCodes(value: unknown): RoleCode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const roleCodes = new Set<RoleCode>();

  for (const item of value) {
    const roleCode = normalizeRoleCode(item);

    if (roleCode) {
      roleCodes.add(roleCode);
    }
  }

  return [...roleCodes];
}

function normalizeRoleCode(value: unknown): RoleCode | null {
  if (
    value === "company_admin" ||
    value === "team_manager" ||
    value === "field_representative"
  ) {
    return value;
  }

  return null;
}

function normalizeUserStatus(value: unknown): UserStatus | null {
  if (value === "active" || value === "suspended" || value === "invited") {
    return value;
  }

  return null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

function throwInvalidRole(): never {
  throw new BadRequestException({
    code: "INVALID_ROLE",
    message: "A valid role code is required.",
  });
}
