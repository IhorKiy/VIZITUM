import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import {
  createPaginatedResponse,
  type PaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import {
  ANNOUNCEMENT_BODY_MAX_LENGTH,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
  type ActiveAnnouncementsResponse,
  type AnnouncementResponse,
  type AnnouncementState,
  type AnnouncementWithReadStats,
  type CreateAnnouncementRequestBody,
  type ListAnnouncementsQuery,
  type UpdateAnnouncementRequestBody,
} from "./announcements.types";

// A representative opening the app sees what is in force now, not a backlog.
// Capped rather than paginated: the field surface is a card stack on the home
// screen, and a tenant with more than this many notices live at once has a
// process problem the list cannot fix.
const ACTIVE_ANNOUNCEMENTS_LIMIT = 50;

type AnnouncementWithCreator = Prisma.AnnouncementGetPayload<{
  include: typeof announcementInclude;
}>;

type AnnouncementWriteData = {
  title: string;
  body: string;
  startsAt: Date;
  endsAt: Date;
};

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listAnnouncements(
    context: RequestContext,
    query: ListAnnouncementsQuery,
  ): Promise<PaginatedResponse<AnnouncementWithReadStats>> {
    const pagination = resolvePagination(query);
    const today = await this.resolveTenantToday(context.tenantId);
    const where = buildAnnouncementWhere(context.tenantId, query.state, today);

    // recipientCount is the same number for every row on the page, so it is
    // one count query rather than one per announcement.
    const [announcements, total, recipientCount] = await Promise.all([
      this.prisma.announcement.findMany({
        where,
        include: announcementInclude,
        orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.announcement.count({ where }),
      this.countRecipients(context.tenantId),
    ]);

    return createPaginatedResponse(
      announcements.map((announcement) => ({
        ...toAnnouncementResponse(announcement, today),
        readCount: announcement._count.readReceipts,
        recipientCount,
      })),
      pagination,
      total,
    );
  }

  async listActiveAnnouncements(
    context: RequestContext,
  ): Promise<ActiveAnnouncementsResponse> {
    const userId = requireUserId(context);
    const today = await this.resolveTenantToday(context.tenantId);

    const announcements = await this.prisma.announcement.findMany({
      where: buildActiveWhere(context.tenantId, today),
      include: {
        ...announcementInclude,
        // Only this caller's receipt matters here; the manager screen is where
        // the full tally lives.
        readReceipts: {
          where: { tenantId: context.tenantId, userId },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
      take: ACTIVE_ANNOUNCEMENTS_LIMIT,
    });

    const items = announcements.map((announcement) => ({
      ...toAnnouncementResponse(announcement, today),
      isRead: announcement.readReceipts.length > 0,
    }));

    return {
      items,
      unreadCount: items.filter((item) => !item.isRead).length,
    };
  }

  async createAnnouncement(
    context: RequestContext,
    body: CreateAnnouncementRequestBody,
  ): Promise<AnnouncementResponse> {
    const data = parseAnnouncementBody(body);
    const today = await this.resolveTenantToday(context.tenantId);

    const created = await this.prisma.announcement.create({
      data: {
        tenantId: context.tenantId,
        createdByUserId: context.userId ?? null,
        ...data,
      },
      include: announcementInclude,
    });

    return toAnnouncementResponse(created, today);
  }

  async updateAnnouncement(
    context: RequestContext,
    announcementId: string,
    body: UpdateAnnouncementRequestBody,
  ): Promise<AnnouncementResponse> {
    const existing = await this.findTenantAnnouncement(
      context.tenantId,
      announcementId,
    );

    // The window is validated as a whole even when only one end is being
    // moved, so a PATCH cannot leave a row whose end precedes its start.
    const data = parseAnnouncementPatch(body, {
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
    });
    const today = await this.resolveTenantToday(context.tenantId);

    const updated = await this.prisma.announcement.update({
      where: { id: existing.id },
      data,
      include: announcementInclude,
    });

    return toAnnouncementResponse(updated, today);
  }

  // Withdrawing early, not deleting: the read receipts are the record that the
  // team was told, and the announcement is what they say they read. Audited
  // in the same transaction as the write, the same shape TasksService uses for
  // a task delete.
  async archiveAnnouncement(
    context: RequestContext,
    announcementId: string,
  ): Promise<AnnouncementResponse> {
    const existing = await this.findTenantAnnouncement(
      context.tenantId,
      announcementId,
    );

    if (existing.archivedAt) {
      throw new BadRequestException({
        code: "ANNOUNCEMENT_ALREADY_ARCHIVED",
        message: "Announcement is already archived.",
      });
    }

    const today = await this.resolveTenantToday(context.tenantId);

    const archived = await this.prisma.$transaction(async (tx) => {
      const row = await tx.announcement.update({
        where: { id: existing.id },
        data: { archivedAt: new Date() },
        include: announcementInclude,
      });

      await this.auditService.recordEvent(
        context,
        {
          entityType: "announcement",
          entityId: row.id,
          eventType: "announcement.archived",
        },
        tx,
      );

      return row;
    });

    return toAnnouncementResponse(archived, today);
  }

  // Idempotent by construction: the unique constraint on
  // (tenantId, announcementId, userId) makes a second tap keep the original
  // readAt rather than resetting it, so "read" means "first saw it".
  async markAnnouncementRead(
    context: RequestContext,
    announcementId: string,
  ): Promise<{ read: true }> {
    const userId = requireUserId(context);
    const today = await this.resolveTenantToday(context.tenantId);

    // Scoped to what the caller can actually see: marking a scheduled or
    // withdrawn announcement read would put a receipt against something that
    // was never on their screen.
    const announcement = await this.prisma.announcement.findFirst({
      where: {
        id: announcementId,
        ...buildActiveWhere(context.tenantId, today),
      },
      select: { id: true },
    });

    if (!announcement) {
      throw new NotFoundException({
        code: "ANNOUNCEMENT_NOT_FOUND",
        message: "Announcement was not found.",
      });
    }

    await this.prisma.announcementReadReceipt.upsert({
      where: {
        tenantId_announcementId_userId: {
          tenantId: context.tenantId,
          announcementId: announcement.id,
          userId,
        },
      },
      create: {
        tenantId: context.tenantId,
        announcementId: announcement.id,
        userId,
      },
      update: {},
    });

    return { read: true };
  }

  private async findTenantAnnouncement(
    tenantId: string,
    announcementId: string,
  ): Promise<{
    id: string;
    archivedAt: Date | null;
    startsAt: Date;
    endsAt: Date;
  }> {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id: announcementId, tenantId },
      select: { id: true, archivedAt: true, startsAt: true, endsAt: true },
    });

    if (!announcement) {
      throw new NotFoundException({
        code: "ANNOUNCEMENT_NOT_FOUND",
        message: "Announcement was not found.",
      });
    }

    return announcement;
  }

  private async countRecipients(tenantId: string): Promise<number> {
    return this.prisma.user.count({
      where: {
        tenantId,
        deletedAt: null,
        status: "active",
        roles: { some: { tenantId, roleCode: "field_representative" } },
      },
    });
  }

  // "Until the 31st" has to mean the whole 31st for the person in the field,
  // so the window is compared against the tenant's own calendar day, not the
  // server's. Same reasoning as the visit day summary.
  private async resolveTenantToday(tenantId: string): Promise<Date> {
    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });

    return startOfDayInTimeZone(new Date(), tenant?.timezone ?? "UTC");
  }
}

const announcementInclude = {
  createdBy: true,
  _count: { select: { readReceipts: true } },
} satisfies Prisma.AnnouncementInclude;

function buildActiveWhere(
  tenantId: string,
  today: Date,
): Prisma.AnnouncementWhereInput {
  return {
    tenantId,
    archivedAt: null,
    startsAt: { lte: today },
    endsAt: { gte: today },
  };
}

function buildAnnouncementWhere(
  tenantId: string,
  state: AnnouncementState | undefined,
  today: Date,
): Prisma.AnnouncementWhereInput {
  switch (state) {
    case "scheduled":
      return { tenantId, archivedAt: null, startsAt: { gt: today } };
    case "active":
      return buildActiveWhere(tenantId, today);
    case "finished":
      return { tenantId, archivedAt: null, endsAt: { lt: today } };
    case "archived":
      return { tenantId, archivedAt: { not: null } };
    default:
      return { tenantId };
  }
}

function resolveState(
  announcement: { archivedAt: Date | null; startsAt: Date; endsAt: Date },
  today: Date,
): AnnouncementState {
  if (announcement.archivedAt) return "archived";
  if (announcement.startsAt.getTime() > today.getTime()) return "scheduled";
  if (announcement.endsAt.getTime() < today.getTime()) return "finished";
  return "active";
}

function parseAnnouncementBody(
  body: CreateAnnouncementRequestBody,
): AnnouncementWriteData {
  const title = normalizeText(
    body.title,
    "title",
    ANNOUNCEMENT_TITLE_MAX_LENGTH,
  );
  const text = normalizeText(body.body, "body", ANNOUNCEMENT_BODY_MAX_LENGTH);
  const startsAt = parseDateOnly(body.startsAt, "startsAt");
  const endsAt = parseDateOnly(body.endsAt, "endsAt");

  assertWindowOrdered(startsAt, endsAt);

  return { title, body: text, startsAt, endsAt };
}

function parseAnnouncementPatch(
  body: UpdateAnnouncementRequestBody,
  current: { startsAt: Date; endsAt: Date },
): Partial<AnnouncementWriteData> {
  const startsAt =
    body.startsAt !== undefined
      ? parseDateOnly(body.startsAt, "startsAt")
      : current.startsAt;
  const endsAt =
    body.endsAt !== undefined
      ? parseDateOnly(body.endsAt, "endsAt")
      : current.endsAt;

  assertWindowOrdered(startsAt, endsAt);

  return {
    ...(body.title !== undefined
      ? {
          title: normalizeText(
            body.title,
            "title",
            ANNOUNCEMENT_TITLE_MAX_LENGTH,
          ),
        }
      : {}),
    ...(body.body !== undefined
      ? {
          body: normalizeText(body.body, "body", ANNOUNCEMENT_BODY_MAX_LENGTH),
        }
      : {}),
    ...(body.startsAt !== undefined ? { startsAt } : {}),
    ...(body.endsAt !== undefined ? { endsAt } : {}),
  };
}

function assertWindowOrdered(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() < startsAt.getTime()) {
    throw new BadRequestException({
      code: "ANNOUNCEMENT_INVALID",
      message: "Announcement window is invalid.",
      fieldErrors: { endsAt: ["End date cannot be before the start date."] },
    });
  }
}

function normalizeText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const normalizedValue = typeof value === "string" ? value.trim() : "";

  if (!normalizedValue) {
    throw new BadRequestException({
      code: "ANNOUNCEMENT_INVALID",
      message: "Announcement field is required.",
      fieldErrors: { [field]: ["Value is required."] },
    });
  }

  if (normalizedValue.length > maxLength) {
    throw new BadRequestException({
      code: "ANNOUNCEMENT_INVALID",
      message: "Announcement field is too long.",
      fieldErrors: {
        [field]: [`Value cannot exceed ${maxLength} characters.`],
      },
    });
  }

  return normalizedValue;
}

function parseDateOnly(value: unknown, field: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException({
      code: "DATE_INVALID",
      message: "Date value must use YYYY-MM-DD format.",
      fieldErrors: { [field]: ["Use the YYYY-MM-DD format."] },
    });
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      code: "DATE_INVALID",
      message: "Date value must use YYYY-MM-DD format.",
      fieldErrors: { [field]: ["Use the YYYY-MM-DD format."] },
    });
  }

  return date;
}

// The tenant's current calendar day, expressed the way the date-only columns
// are stored (UTC midnight), so the two can be compared directly. An unusable
// timezone falls back to UTC rather than failing the request — a notice board
// that 500s is worse than one whose window turns over a few hours off.
function startOfDayInTimeZone(moment: Date, timeZone: string): Date {
  let day: string;

  try {
    day = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(moment);
  } catch {
    day = moment.toISOString().slice(0, 10);
  }

  return new Date(`${day}T00:00:00.000Z`);
}

function requireUserId(context: RequestContext): string {
  if (!context.userId) {
    throw new ForbiddenException({
      code: "ANNOUNCEMENT_SCOPE_FORBIDDEN",
      message: "You cannot access announcements.",
    });
  }

  return context.userId;
}

function toAnnouncementResponse(
  announcement: AnnouncementWithCreator,
  today: Date,
): AnnouncementResponse {
  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    startsAt: announcement.startsAt.toISOString().slice(0, 10),
    endsAt: announcement.endsAt.toISOString().slice(0, 10),
    state: resolveState(announcement, today),
    archivedAt: announcement.archivedAt?.toISOString() ?? null,
    createdByUserId: announcement.createdByUserId,
    createdBy: announcement.createdBy
      ? {
          id: announcement.createdBy.id,
          email: announcement.createdBy.email,
          name: announcement.createdBy.name,
        }
      : null,
    createdAt: announcement.createdAt.toISOString(),
    updatedAt: announcement.updatedAt.toISOString(),
  };
}
