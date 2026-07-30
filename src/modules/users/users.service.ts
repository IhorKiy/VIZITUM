import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  type InviteEmailStatus,
  type RoleCode,
  type User,
  type UserRole,
  type UserStatus,
} from "@prisma/client";
import { randomBytes } from "node:crypto";

import { normalizeEmail } from "../../common/normalize";
import {
  buildUserNameFields,
  normalizeNamePart,
} from "../../common/person-name";
import { normalizePhoneInput } from "../../common/phone";
import {
  createPaginatedResponse,
  type PaginatedResponse,
  type PaginationInput,
  resolvePagination,
} from "../../common/pagination";
import { withSerializationRetry } from "../../common/prisma-retry";
import { MILLISECONDS_PER_DAY } from "../../common/time";
import { AuditService } from "../audit/audit.service";
import { hashValue } from "../auth/auth-crypto";
import { SessionService } from "../auth/session.service";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import {
  DEFAULT_ADMIN_LIMIT,
  resolveAdminCap,
  type AddUserRoleRequestBody,
  type DeleteUserResponse,
  type InviteHistoryItem,
  type InviteUserRequestBody,
  type InviteUserResponse,
  type UpdateUserRequestBody,
  type UserResponse,
} from "./users.types";

const INVITE_TOKEN_BYTES = 32;
const INVITE_TTL_DAYS = 7;

type UserWithRoles = User & { roles: UserRole[] };
type PrismaClientOrTx = PrismaService | Prisma.TransactionClient;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
  ) {}

  async listUsers(
    context: RequestContext,
    paginationInput: PaginationInput,
  ): Promise<
    PaginatedResponse<UserResponse> & {
      adminLimit: number;
      activeAdminCount: number;
    }
  > {
    const pagination = resolvePagination(paginationInput);
    const where = {
      tenantId: context.tenantId,
      deletedAt: null,
    };

    const [users, total, tenant, activeAdminCount] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { roles: true },
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.user.count({ where }),
      this.prisma.platformTenant.findUnique({
        where: { id: context.tenantId },
        select: { adminLimit: true, status: true },
      }),
      this.prisma.user.count({
        where: {
          tenantId: context.tenantId,
          status: "active",
          deletedAt: null,
          roles: {
            some: { tenantId: context.tenantId, roleCode: "company_admin" },
          },
        },
      }),
    ]);

    return {
      ...createPaginatedResponse(users.map(toUserResponse), pagination, total),
      adminLimit: tenant ? resolveAdminCap(tenant) : DEFAULT_ADMIN_LIMIT,
      activeAdminCount,
    };
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

    const invitesAdmin = roleCodes.includes("company_admin");

    if (invitesAdmin) {
      this.assertActorCanInviteAdmins(context);
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

    if (invitesAdmin) {
      await this.assertAdminLimitNotExceeded(this.prisma, context.tenantId);
    }

    const invite = await this.createInvite(context, email, roleCodes);

    if (invitesAdmin) {
      await this.auditService.recordEvent(context, {
        entityType: "user",
        entityId: invite.id,
        eventType: "admin.invited",
        metadata: { email: invite.email },
      });
    }

    return invite;
  }

  async listInvites(context: RequestContext): Promise<InviteHistoryItem[]> {
    const invites = await this.prisma.invite.findMany({
      where: {
        tenantId: context.tenantId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        acceptedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    });

    return invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      roleCodes: invite.roleCodes,
      status: resolveInviteStatus(invite.status, invite.expiresAt),
      emailStatus: invite.emailStatus,
      emailSentAt: invite.emailSentAt?.toISOString() ?? null,
      expiresAt: invite.expiresAt.toISOString(),
      acceptedAt: invite.acceptedAt?.toISOString() ?? null,
      createdAt: invite.createdAt.toISOString(),
      createdBy: invite.createdBy,
      acceptedBy: invite.acceptedBy,
    }));
  }

  async resendInvite(
    context: RequestContext,
    inviteId: string,
  ): Promise<InviteUserResponse> {
    const invite = await this.prisma.invite.findFirst({
      where: {
        id: inviteId,
        tenantId: context.tenantId,
      },
      select: {
        id: true,
        email: true,
        roleCodes: true,
        status: true,
        expiresAt: true,
      },
    });

    if (!invite) {
      throw new NotFoundException({
        code: "INVITE_NOT_FOUND",
        message: "Invite was not found.",
      });
    }

    if (invite.status !== "pending") {
      throw new ConflictException({
        code: "INVITE_NOT_PENDING",
        message: "Only pending invites can be resent.",
      });
    }

    if (invite.roleCodes.includes("tenant_superadmin")) {
      throw new ForbiddenException({
        code: "ADMIN_MANAGEMENT_FORBIDDEN",
        message:
          "Only the platform owner can manage the tenant superadmin invite.",
      });
    }

    if (invite.roleCodes.includes("company_admin")) {
      this.assertActorCanInviteAdmins(context);
    }

    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { status: "revoked" },
    });

    return this.createInvite(context, invite.email, invite.roleCodes);
  }

  async updateUser(
    context: RequestContext,
    userId: string,
    body: UpdateUserRequestBody,
  ): Promise<UserResponse> {
    const status = normalizeUserStatus(body.status);
    const firstName = normalizeNamePart(body.firstName);
    const lastName = normalizeNamePart(body.lastName);

    // Validated against the tenant's phoneCountry before the transaction so a
    // bad phone never costs a serializable-transaction round trip. An
    // unchanged phone skips validation entirely (and drops out of the update)
    // so a user whose legacy phone predates normalization can still have
    // their name/status edited.
    let includePhone = false;
    let phone: string | null = null;

    if (body.phone === null || typeof body.phone === "string") {
      const [tenant, currentUser] = await Promise.all([
        this.prisma.platformTenant.findUniqueOrThrow({
          where: { id: context.tenantId },
          select: { phoneCountry: true },
        }),
        this.prisma.user.findFirst({
          where: { id: userId, tenantId: context.tenantId },
          select: { phone: true },
        }),
      ]);

      if (body.phone !== (currentUser?.phone ?? null)) {
        const normalizedPhone = normalizePhoneInput(
          body.phone,
          tenant.phoneCountry,
        );

        if (!normalizedPhone.ok) {
          throw new BadRequestException({
            code: "USER_PHONE_INVALID",
            message: "Phone number is invalid.",
            fieldErrors: {
              phone: [
                normalizedPhone.reason === "country_required"
                  ? "Enter the phone in international format (+...)."
                  : "Enter a valid phone number.",
              ],
            },
          });
        }

        includePhone = true;
        phone = normalizedPhone.e164;
      }
    }

    const { user: updatedUser, statusChangeAudit } =
      await withSerializationRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            const user = await this.findTenantUser(
              tx,
              context.tenantId,
              userId,
            );
            const isCompanyAdminTarget = user.roles.some(
              (role) => role.roleCode === "company_admin",
            );
            const isStatusChanging = Boolean(status) && status !== user.status;
            let statusChangeAudit: { previousStatus: UserStatus } | null = null;

            // Directional protection covers the whole record, not just status:
            // a plain company_admin must not be able to edit a superadmin's or
            // another admin's name/phone either, so these run unconditionally
            // rather than only when isStatusChanging.
            this.assertTargetNotSuperadmin(user);

            if (isCompanyAdminTarget) {
              this.assertActorCanManageAdmins(context);
            }

            if (isStatusChanging && isCompanyAdminTarget) {
              if (user.status === "active" && status !== "active") {
                await this.assertLeadershipNotLocked(
                  tx,
                  context.tenantId,
                  user.id,
                );
              }

              if (status === "active" && user.status !== "active") {
                await this.assertAdminLimitNotExceeded(tx, context.tenantId);
              }

              statusChangeAudit = { previousStatus: user.status };
            }

            // Either part can be edited alone, so the display name is composed
            // from the stored row rather than from the request — otherwise
            // renaming just the surname would leave `name` carrying the old
            // one. Reading `user` inside the serializable transaction is what
            // keeps that composition from racing a concurrent rename.
            const nameFields =
              firstName || lastName
                ? buildUserNameFields({
                    firstName: firstName ?? user.firstName,
                    lastName: lastName ?? user.lastName,
                  })
                : null;

            const updated = await tx.user.update({
              where: { id: user.id },
              data: {
                ...(nameFields ?? {}),
                ...(includePhone ? { phone } : {}),
                ...(status ? { status } : {}),
              },
              include: { roles: true },
            });

            return { user: updated, statusChangeAudit };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );

    if (statusChangeAudit) {
      await this.auditService.recordEvent(context, {
        entityType: "user",
        entityId: userId,
        eventType:
          updatedUser.status === "active"
            ? "admin.reactivated"
            : "admin.suspended",
        metadata: {
          previousStatus: statusChangeAudit.previousStatus,
          status: updatedUser.status,
        },
      });

      // Symmetric with deleteUser: a suspended admin shouldn't keep riding
      // an existing session until it naturally expires or they hit a
      // request PermissionGuard happens to reject.
      if (updatedUser.status !== "active") {
        await this.sessionService.revokeUserSessions(context.tenantId, userId);
      }
    }

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

    const grantsAdmin = roleCode === "company_admin";

    if (grantsAdmin) {
      this.assertActorCanInviteAdmins(context);
    }

    // The limit check and the role upsert must be atomic under Serializable
    // isolation (matching updateUser/removeRole/deleteUser): otherwise two
    // concurrent grants can each read the count as under the limit before
    // either commits, both proceed, and the tenant ends up over its
    // adminLimit.
    await withSerializationRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const user = await this.findTenantUser(tx, context.tenantId, userId);

          this.assertTargetNotSuperadmin(user);

          if (grantsAdmin) {
            await this.assertAdminLimitNotExceeded(tx, context.tenantId);
          }

          await tx.userRole.upsert({
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
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );

    if (grantsAdmin) {
      await this.auditService.recordEvent(context, {
        entityType: "user",
        entityId: userId,
        eventType: "admin.role_granted",
      });
    }

    return this.getUserResponse(context.tenantId, userId);
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

    let revokesAdmin = false;

    await withSerializationRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const user = await this.findTenantUser(tx, context.tenantId, userId);

          this.assertTargetNotSuperadmin(user);

          revokesAdmin =
            roleCode === "company_admin" &&
            user.roles.some((role) => role.roleCode === "company_admin");

          if (revokesAdmin) {
            this.assertActorCanManageAdmins(context);

            if (user.status === "active") {
              await this.assertLeadershipNotLocked(
                tx,
                context.tenantId,
                user.id,
              );
            }
          }

          if (
            user.roles.length <= 1 &&
            user.roles.some((role) => role.roleCode === roleCode)
          ) {
            throw new ConflictException({
              code: "USER_LAST_ROLE",
              message: "A user must keep at least one role.",
            });
          }

          await tx.userRole.deleteMany({
            where: {
              tenantId: context.tenantId,
              userId: user.id,
              roleCode,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );

    if (revokesAdmin) {
      await this.auditService.recordEvent(context, {
        entityType: "user",
        entityId: userId,
        eventType: "admin.role_revoked",
      });
    }

    return this.getUserResponse(context.tenantId, userId);
  }

  async deleteUser(
    context: RequestContext,
    userId: string,
  ): Promise<DeleteUserResponse> {
    await withSerializationRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const user = await this.findTenantUser(tx, context.tenantId, userId);

          this.assertTargetNotSuperadmin(user);

          if (!user.roles.some((role) => role.roleCode === "company_admin")) {
            throw new BadRequestException({
              code: "ADMIN_ROLE_REQUIRED",
              message: "Only Company Admin users can be deleted here.",
            });
          }

          this.assertActorCanManageAdmins(context);

          if (user.status === "active") {
            await this.assertLeadershipNotLocked(tx, context.tenantId, user.id);
          }

          await tx.user.update({
            where: { id: user.id },
            data: { status: "deleted", deletedAt: new Date() },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );

    await this.sessionService.revokeUserSessions(context.tenantId, userId);
    await this.auditService.recordEvent(context, {
      entityType: "user",
      entityId: userId,
      eventType: "admin.deleted",
    });

    return { id: userId, status: "deleted" };
  }

  /**
   * Used only by PlatformService — the tenant-facing inviteUser never
   * accepts tenant_superadmin, so the platform owner's invite/replace flow
   * goes through this dedicated path instead.
   */
  async inviteSuperadmin(
    context: RequestContext,
    emailInput: string,
  ): Promise<InviteUserResponse> {
    const email = normalizeEmail(emailInput);

    if (!email) {
      throw new BadRequestException({
        code: "INVITE_INVALID",
        message: "Email is required.",
        fieldErrors: { email: ["Email is required."] },
      });
    }

    const existingUser = await this.prisma.user.findUnique({
      where: {
        tenantId_email: { tenantId: context.tenantId, email },
      },
      select: { id: true, deletedAt: true },
    });

    if (existingUser && !existingUser.deletedAt) {
      throw new ConflictException({
        code: "USER_ALREADY_EXISTS",
        message: "User already exists in this tenant.",
        fieldErrors: { email: ["User already exists in this tenant."] },
      });
    }

    return this.createInvite(context, email, ["tenant_superadmin"]);
  }

  /**
   * Used only by PlatformService's bootstrap/migration path — promotes an
   * existing active Company Admin to tenant superadmin, demoting any other
   * currently active superadmin (see the replacement semantics in
   * docs/plans/tenant-superadmin-plan-prompt.md).
   */
  async promoteToSuperadmin(
    context: RequestContext,
    userId: string,
  ): Promise<UserResponse> {
    const { promoted, demotedSuperadminIds } = await withSerializationRetry(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const user = await this.findTenantUser(
              tx,
              context.tenantId,
              userId,
            );

            if (
              user.status !== "active" ||
              !user.roles.some((role) => role.roleCode === "company_admin")
            ) {
              throw new BadRequestException({
                code: "ADMIN_ROLE_REQUIRED",
                message:
                  "Only an active Company Admin can be promoted to tenant superadmin.",
              });
            }

            const previousSuperadmins = await tx.user.findMany({
              where: {
                tenantId: context.tenantId,
                id: { not: user.id },
                status: "active",
                deletedAt: null,
                roles: {
                  some: {
                    tenantId: context.tenantId,
                    roleCode: "tenant_superadmin",
                  },
                },
              },
              select: { id: true },
            });

            // Demote to a suspended company_admin rather than leaving them
            // holding tenant_superadmin while suspended — that role is
            // otherwise unreachable by anyone (assertTargetNotSuperadmin blocks
            // every tenant-side action against it, and there is no platform
            // endpoint for an inactive superadmin), which would make the
            // account a permanent dead end. See the matching note in
            // AuthService.acceptInvite. Audited the same way as that path
            // (superadmin.replaced) via `tx` directly, since AuditService isn't
            // transaction-aware.
            const demotedSuperadminIds: string[] = [];

            for (const previousSuperadmin of previousSuperadmins) {
              demotedSuperadminIds.push(previousSuperadmin.id);

              await tx.user.update({
                where: { id: previousSuperadmin.id },
                data: {
                  status: "suspended",
                  lastSelectedRoleCode: "company_admin",
                },
              });

              await tx.userRole.deleteMany({
                where: {
                  tenantId: context.tenantId,
                  userId: previousSuperadmin.id,
                  roleCode: "tenant_superadmin",
                },
              });

              await tx.userRole.upsert({
                where: {
                  tenantId_userId_roleCode: {
                    tenantId: context.tenantId,
                    userId: previousSuperadmin.id,
                    roleCode: "company_admin",
                  },
                },
                create: {
                  tenantId: context.tenantId,
                  userId: previousSuperadmin.id,
                  roleCode: "company_admin",
                  assignedByUserId: context.userId,
                },
                update: {},
              });

              await tx.auditEvent.create({
                data: {
                  tenantId: context.tenantId,
                  actorUserId: context.userId ?? null,
                  entityType: "user",
                  entityId: previousSuperadmin.id,
                  eventType: "superadmin.replaced",
                  metadata: { newSuperadminUserId: user.id },
                  requestId: context.requestId,
                },
              });
            }

            await tx.userRole.deleteMany({
              where: {
                tenantId: context.tenantId,
                userId: user.id,
                roleCode: "company_admin",
              },
            });

            await tx.userRole.upsert({
              where: {
                tenantId_userId_roleCode: {
                  tenantId: context.tenantId,
                  userId: user.id,
                  roleCode: "tenant_superadmin",
                },
              },
              create: {
                tenantId: context.tenantId,
                userId: user.id,
                roleCode: "tenant_superadmin",
                assignedByUserId: context.userId,
              },
              update: {},
            });

            const promoted = await tx.user.update({
              where: { id: user.id },
              data: { lastSelectedRoleCode: "tenant_superadmin" },
              include: { roles: true },
            });

            return { promoted, demotedSuperadminIds };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
    );

    // Revoked after commit, not inside the transaction: SessionService
    // writes through `this.prisma`, not `tx`, so it can't participate in the
    // transaction's atomicity anyway, and revoking only once the demotion is
    // durably committed avoids revoking a session for a demotion that then
    // rolls back.
    for (const demotedSuperadminId of demotedSuperadminIds) {
      await this.sessionService.revokeUserSessions(
        context.tenantId,
        demotedSuperadminId,
      );
    }

    return toUserResponse(promoted);
  }

  private assertActorCanInviteAdmins(context: RequestContext): void {
    if (!context.permissions.includes(PERMISSIONS.ADMINS_INVITE)) {
      throw new ForbiddenException({
        code: "ADMIN_MANAGEMENT_FORBIDDEN",
        message: "Only the tenant superadmin can invite Company Admins.",
      });
    }
  }

  private assertActorCanManageAdmins(context: RequestContext): void {
    if (!context.permissions.includes(PERMISSIONS.ADMINS_MANAGE)) {
      throw new ForbiddenException({
        code: "ADMIN_MANAGEMENT_FORBIDDEN",
        message: "Only the tenant superadmin can manage Company Admins.",
      });
    }
  }

  private assertTargetNotSuperadmin(user: UserWithRoles): void {
    if (user.roles.some((role) => role.roleCode === "tenant_superadmin")) {
      throw new ConflictException({
        code: "SUPERADMIN_PROTECTED",
        message:
          "The tenant superadmin can only be replaced by the platform owner.",
      });
    }
  }

  private async assertAdminLimitNotExceeded(
    client: PrismaClientOrTx,
    tenantId: string,
  ): Promise<void> {
    const tenant = await client.platformTenant.findUnique({
      where: { id: tenantId },
      select: { adminLimit: true, status: true },
    });
    const adminLimit = tenant ? resolveAdminCap(tenant) : DEFAULT_ADMIN_LIMIT;

    const activeAdminCount = await client.user.count({
      where: {
        tenantId,
        status: "active",
        deletedAt: null,
        roles: { some: { tenantId, roleCode: "company_admin" } },
      },
    });

    if (activeAdminCount >= adminLimit) {
      throw new ConflictException({
        code: "TENANT_ADMIN_LIMIT",
        message: `This tenant is limited to ${adminLimit} active Company Admin(s).`,
      });
    }
  }

  /**
   * Anti-lockout guard for company_admin. The tenant_superadmin side of this
   * invariant ("keep at least one active superadmin") doesn't need a count
   * check here: assertTargetNotSuperadmin already blocks every status/role
   * change against a superadmin target unconditionally, and the only flows
   * that legitimately change who the active superadmin is
   * (promoteToSuperadmin, the accept-invite replacement in AuthService)
   * activate the new one before deactivating the old one, so the active
   * count never transiently hits zero. Tenants that haven't been migrated
   * to have a superadmin yet (bootstrap fallback) fall back to the old rule
   * of protecting the last active company_admin instead — once a superadmin
   * is active, the Company Admin count is free to hit zero.
   */
  private async assertLeadershipNotLocked(
    client: PrismaClientOrTx,
    tenantId: string,
    excludeUserId: string,
  ): Promise<void> {
    const activeSuperadminCount = await client.user.count({
      where: {
        tenantId,
        status: "active",
        deletedAt: null,
        roles: { some: { tenantId, roleCode: "tenant_superadmin" } },
      },
    });

    if (activeSuperadminCount > 0) {
      return;
    }

    const otherActiveAdminCount = await client.user.count({
      where: {
        tenantId,
        id: { not: excludeUserId },
        status: "active",
        deletedAt: null,
        roles: { some: { tenantId, roleCode: "company_admin" } },
      },
    });

    if (otherActiveAdminCount === 0) {
      throw new ConflictException({
        code: "TENANT_LAST_ADMIN",
        message: "This tenant must keep at least one active Company Admin.",
      });
    }
  }

  private async getUserResponse(
    tenantId: string,
    userId: string,
  ): Promise<UserResponse> {
    const user = await this.findTenantUser(this.prisma, tenantId, userId);

    return toUserResponse(user);
  }

  private async findTenantUser(
    client: PrismaClientOrTx,
    tenantId: string,
    userId: string,
  ): Promise<UserWithRoles> {
    const user = await client.user.findFirst({
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

  private async createInvite(
    context: RequestContext,
    email: string,
    roleCodes: RoleCode[],
  ): Promise<InviteUserResponse> {
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

    const emailStatus = await this.dispatchInviteEmail(
      context,
      invite.id,
      email,
      token,
      expiresAt,
    );

    return {
      id: invite.id,
      email: invite.email,
      roleCodes: invite.roleCodes,
      status: invite.status,
      emailStatus,
      expiresAt: invite.expiresAt.toISOString(),
      token,
    };
  }

  /**
   * Best-effort invite email: never throws, so an unreachable or
   * misconfigured email provider can't break invite creation — the accept
   * link shown in the UI stays the guaranteed fallback. The outcome is
   * persisted on the invite row (`skipped` is the column default, so only
   * real attempts write).
   */
  private async dispatchInviteEmail(
    context: RequestContext,
    inviteId: string,
    email: string,
    token: string,
    expiresAt: Date,
  ): Promise<InviteEmailStatus> {
    if (!this.emailService.isEnabled()) {
      return "skipped";
    }

    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: context.tenantId },
      select: { name: true, slug: true, language: true, timezone: true },
    });

    if (!tenant) {
      return "skipped";
    }

    const emailStatus = await this.emailService.sendInviteEmail({
      to: email,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      language: tenant.language,
      timezone: tenant.timezone,
      token,
      expiresAt,
      requestId: context.requestId,
    });

    if (emailStatus !== "skipped") {
      await this.prisma.invite.update({
        where: { id: inviteId },
        data: {
          emailStatus,
          emailSentAt: emailStatus === "sent" ? new Date() : null,
        },
      });
    }

    return emailStatus;
  }
}

function toUserResponse(user: UserWithRoles): UserResponse {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    name: user.name,
    phone: user.phone,
    status: user.status,
    lastSelectedRoleCode: user.lastSelectedRoleCode,
    roleCodes: user.roles.map((role) => role.roleCode),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
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

export function resolveInviteStatus(status: string, expiresAt: Date): string {
  if (status === "pending" && expiresAt <= new Date()) {
    return "expired";
  }

  return status;
}

function throwInvalidRole(): never {
  throw new BadRequestException({
    code: "INVALID_ROLE",
    message: "A valid role code is required.",
  });
}
