import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { VisitCancellationReason, VisitStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  createPaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import { StorageService } from "../storage/storage.service";
import type { RequestContext } from "../tenancy/request-context";
import {
  extractTasksToCreate,
  findReportCreatedTasks,
  isRecord,
  toReportResponse,
} from "./report-response.util";
import {
  applyShelfCheck,
  extractShelfCheck,
  parseDateOnly,
  VISIT_DATE_BACKDATE_WINDOW_DAYS,
} from "./shelf-check";
import type {
  AddTextVisitNoteRequestBody,
  CancelVisitRequestBody,
  ConfirmReportRequestBody,
  CreateVisitRequestBody,
  ListVisitsQuery,
  RegisterAudioUploadRequestBody,
  RegisteredAudioUploadResponse,
  RegisterProblemPhotoRequestBody,
  RegisteredProblemPhotoResponse,
  ReportResponse,
  UpdateVisitRequestBody,
  VisitDaySummaryEntry,
  VisitDaySummaryResponse,
  VisitListResponse,
  VisitNoteResponse,
  VisitPeriodResponse,
  VisitResponse,
  VisitStatusTotals,
} from "./visits.types";

// Mirrors INPUT_LIMITS.comment in apps/web/lib/input-limits.ts.
export const MAX_VISIT_CANCELLATION_COMMENT_LENGTH = 500;
const VISIT_CANCELLATION_REASONS: readonly VisitCancellationReason[] = [
  "location_closed",
  "client_unavailable",
  "route_changed",
  "other",
];

// Long enough for any UUID scheme a client might use, short enough that the
// token cannot be used to smuggle a payload into an index.
const MAX_CLIENT_REQUEST_ID_LENGTH = 128;

const TEMPORARY_AUDIO_TTL_HOURS = 24;
const MAX_TEMPORARY_AUDIO_SIZE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_AUDIO_CONTENT_TYPES = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/aac",
  "audio/mpeg",
  "audio/wav",
]);
const MAX_PROBLEM_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
// How long a registered-but-unconfirmed problem photo survives before the
// cleanup worker collects it. Same window the temporary audio uses.
const UNCONFIRMED_PHOTO_TTL_HOURS = 24;
const SUPPORTED_PHOTO_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const PHOTO_CONTENT_TYPE_ALIASES = new Map([
  ["image/jpg", "image/jpeg"],
  ["image/pjpeg", "image/jpeg"],
]);
const AUDIO_CONTENT_TYPE_ALIASES = new Map([
  ["audio/m4a", "audio/mp4"],
  ["audio/mp3", "audio/mpeg"],
  ["audio/wave", "audio/wav"],
  ["audio/x-m4a", "audio/mp4"],
  ["audio/x-wav", "audio/wav"],
  ["video/mp4", "audio/mp4"],
]);

type VisitWithRelations = Prisma.VisitGetPayload<{
  include: {
    location: true;
    representative: true;
  };
}>;

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService?: StorageService,
  ) {}

  async listVisits(
    context: RequestContext,
    query: ListVisitsQuery,
  ): Promise<VisitListResponse> {
    const pagination = resolvePagination(query);
    // Resolved once and handed to both WHERE builders: computing it twice
    // would take `now` twice, and a request that straddles a millisecond
    // would count its totals over a hair-different window than its list.
    const period = resolveVisitPeriodRange(query.startedFrom, query.startedTo);
    const where = buildVisitWhere(context, query, period);
    // The same period and filters minus the status one: the recap this feeds
    // is what the status pills are picked *from*, so a pill narrows the list
    // below it without narrowing the split above it. One grouped aggregate
    // here replaced the three extra count requests the field history screen
    // used to fire per render.
    const statusTotalsWhere = buildVisitWhere(
      context,
      { ...query, status: undefined },
      period,
    );
    const [visits, total, statusGroups] = await Promise.all([
      this.prisma.visit.findMany({
        where,
        include: visitInclude,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.visit.count({ where }),
      this.prisma.visit.groupBy({
        by: ["status"],
        where: statusTotalsWhere,
        _count: { _all: true },
      }),
    ]);

    return {
      ...createPaginatedResponse(
        visits.map(toVisitResponse),
        pagination,
        total,
      ),
      period: toVisitPeriodResponse(period),
      statusTotals: toVisitStatusTotals(statusGroups),
    };
  }

  // Per-day totals for the exact same filter listVisits uses, over the whole
  // matching set rather than one page — so a day header stays correct even
  // when that day's visits straddle a page boundary. Aggregated in SQL rather
  // than fetched row-by-row: this endpoint shares visits.read_team scope with
  // GET /visits, so with no date filter a row-fetching version would mean
  // pulling a tenant's entire visit history into memory on every request.
  async getVisitDaySummary(
    context: RequestContext,
    query: ListVisitsQuery,
  ): Promise<VisitDaySummaryResponse> {
    const representativeFilter = resolveVisitRepresentativeFilter(
      context,
      query,
    );
    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: context.tenantId },
      select: { timezone: true },
    });

    if (!tenant) {
      throw new BadRequestException({
        code: "TENANT_INVALID",
        message: "Tenant could not be resolved.",
      });
    }

    const conditions: Prisma.Sql[] = [
      Prisma.sql`"tenantId" = ${context.tenantId}`,
    ];

    if (representativeFilter) {
      conditions.push(
        Prisma.sql`"representativeUserId" = ${representativeFilter}`,
      );
    }

    if (query.locationId) {
      conditions.push(Prisma.sql`"locationId" = ${query.locationId}`);
    }

    if (query.routePlanId) {
      conditions.push(
        Prisma.sql`"routeItemId" IN (SELECT id FROM route_items WHERE "tenantId" = ${context.tenantId} AND "routePlanId" = ${query.routePlanId})`,
      );
    }

    if (query.status && query.status.length > 0) {
      conditions.push(
        Prisma.sql`status IN (${Prisma.join(
          query.status.map((status) => Prisma.sql`${status}::"VisitStatus"`),
        )})`,
      );
    }

    // The conditions that say *which* visits, before the ones that say *when*.
    // Kept separately because the history boundary below asks the same scope
    // question over all of time: it is the answer to "is there anything older
    // than the window I am looking at", which a window-bounded WHERE can never
    // give.
    const scopeConditions = [...conditions];

    // Always bounded below, even when the caller sent no period at all: this
    // GROUP BY is the one query in the module that would otherwise sweep a
    // tenant's whole visit history on a bare request.
    const startedAtRange = resolveVisitPeriodRange(
      query.startedFrom,
      query.startedTo,
    );

    // Same COALESCE(startedAt, createdAt) fallback as buildVisitWhere's OR
    // (and the day-bucketing expression below): a never-started visit has no
    // startedAt to test against the period, so without this it would drop
    // out of the aggregate the list it recaps still includes.
    conditions.push(
      Prisma.sql`COALESCE("startedAt", "createdAt") >= ${startedAtRange.gte}`,
    );

    if (startedAtRange.lte) {
      conditions.push(
        Prisma.sql`COALESCE("startedAt", "createdAt") <= ${startedAtRange.lte}`,
      );
    }

    // Cast to text in SQL instead of returning a bare `date`: the wire value
    // for `date` gets reconstructed into a JS Date by driver-level type
    // parsing, which reintroduces exactly the local-timezone ambiguity this
    // query exists to avoid. `date::text` is unambiguous — always YYYY-MM-DD,
    // in any driver.
    const [rows, historyRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          day: string;
          total: bigint;
          completed: bigint;
          cancelled: bigint;
        }>
      >(Prisma.sql`
      SELECT
        ((COALESCE("startedAt", "createdAt") AT TIME ZONE 'UTC') AT TIME ZONE ${tenant.timezone})::date::text AS day,
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled')::bigint AS cancelled
      FROM visits
      WHERE ${Prisma.join(conditions, " AND ")}
      GROUP BY day
      ORDER BY day DESC
    `),
      // Where this scope's history actually begins — the one fact a screen
      // cannot derive from a bounded window, and the difference between "no
      // visits before this window" and "nothing here, keep walking backwards".
      // Deliberately unbounded in time while carrying every other condition
      // (tenant, representative, location, route, status), so it answers for
      // the same set of visits the days above describe.
      //
      // MIN over the COALESCE expression, which is exactly what the visit
      // period indexes are sorted by — Postgres rewrites it into a one-row
      // index scan rather than an aggregate over the scope. With a status
      // filter that role passes to the status-prefixed pair added in
      // 20260728160000; without one, to the plain expression pair from
      // 20260728120000. Either way it costs ~4 shared buffers on a 300k-row
      // table. The one shape neither covers is a *multi*-status filter, where
      // MIN over `status = ANY(...)` cannot be a single boundary scan and the
      // scan walks to its first match — no screen sends more than one status.
      //
      // It lives on day-summary rather than on the list because only field
      // history needs it, and the other eight callers of GET /visits should
      // not pay for a query they never read.
      this.prisma.$queryRaw<Array<{ historyStart: Date | null }>>(Prisma.sql`
      SELECT MIN(COALESCE("startedAt", "createdAt")) AS "historyStart"
      FROM visits
      WHERE ${Prisma.join(scopeConditions, " AND ")}
    `),
    ]);
    // A tenant (or a representative) with no visits at all has no earliest
    // one. That is a valid answer, not a failure: the screen reads it as "this
    // history has no floor to reach".
    const historyStart = historyRows[0]?.historyStart ?? null;

    return {
      days: rows.map((row): VisitDaySummaryEntry => ({
        day: row.day,
        total: Number(row.total),
        completed: Number(row.completed),
        cancelled: Number(row.cancelled),
      })),
      period: toVisitPeriodResponse(startedAtRange),
      historyStart: historyStart ? historyStart.toISOString() : null,
    };
  }

  async getVisit(
    context: RequestContext,
    visitId: string,
  ): Promise<VisitResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanReadVisit(context, visit.representativeUserId);

    return toVisitResponse(visit);
  }

  async getVisitReport(
    context: RequestContext,
    visitId: string,
  ): Promise<ReportResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanReadReport(context, visit.representativeUserId);

    const report = await this.prisma.report.findFirst({
      where: {
        tenantId: context.tenantId,
        visitId: visit.id,
      },
    });

    if (!report) {
      throw new NotFoundException({
        code: "REPORT_NOT_FOUND",
        message: "Report was not found for this visit.",
      });
    }

    const createdTasks = await findReportCreatedTasks(
      this.prisma,
      context.tenantId,
      report.id,
    );

    return toReportResponse(report, createdTasks);
  }

  async createVisit(
    context: RequestContext,
    body: CreateVisitRequestBody,
  ): Promise<VisitResponse> {
    if (!context.permissions.includes(PERMISSIONS.VISITS_CREATE)) {
      throwMissingVisitPermission();
    }

    const locationId = normalizeId(body.locationId);
    const representativeUserId =
      normalizeId(body.representativeUserId) ?? context.userId;
    const routeItemId = normalizeOptionalId(body.routeItemId);
    const visitType = normalizeRequiredString(body.visitType);

    if (!locationId || !representativeUserId || !visitType) {
      throw new BadRequestException({
        code: "VISIT_INVALID",
        message: "Location, representative and visit type are required.",
      });
    }

    this.assertCanCreateVisitForRepresentative(context, representativeUserId);
    await Promise.all([
      this.assertTenantLocation(context.tenantId, locationId),
      this.assertFieldRepresentative(context.tenantId, representativeUserId),
    ]);

    if (routeItemId) {
      await this.assertRouteItemMatchesVisit(
        context.tenantId,
        routeItemId,
        locationId,
        representativeUserId,
      );
    }

    const visit = await this.prisma.visit.create({
      data: {
        tenantId: context.tenantId,
        locationId,
        representativeUserId,
        routeItemId,
        visitType,
        status: "in_progress",
        startedAt: parseOptionalDateTime(body.startedAt) ?? new Date(),
      },
      include: visitInclude,
    });

    return toVisitResponse(visit);
  }

  async updateVisit(
    context: RequestContext,
    visitId: string,
    body: UpdateVisitRequestBody,
  ): Promise<VisitResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanUpdateVisit(context, visit.representativeUserId);

    // Cancelled is terminal. Without this, `status: "completed"` would flip a
    // cancelled visit back while `cancelledAt`/`cancellationReason` stayed
    // populated (a row shape the data model rules out) and would revive its
    // skipped route stop as visited.
    if (visit.status === "cancelled") {
      throw new ConflictException({
        code: "VISIT_NOT_ACTIVE",
        message: "A cancelled visit can no longer be updated.",
      });
    }

    if (body.status === "cancelled") {
      throw new BadRequestException({
        code: "VISIT_STATUS_INVALID",
        message: "Use POST /visits/:visitId/cancel to cancel a visit.",
      });
    }

    const status = normalizeVisitStatus(body.status);
    const completedAt = parseOptionalDateTime(body.completedAt);

    const updatedVisit = await this.prisma.$transaction(async (tx) => {
      const result = await tx.visit.update({
        where: { id: visit.id },
        data: {
          ...(status ? { status } : {}),
          ...(body.startedAt !== undefined
            ? { startedAt: parseOptionalDateTime(body.startedAt) }
            : {}),
          ...(body.completedAt !== undefined ? { completedAt } : {}),
          ...(status === "completed" && body.completedAt === undefined
            ? { completedAt: new Date() }
            : {}),
        },
        include: visitInclude,
      });

      if (result.routeItemId && status === "completed") {
        await tx.routeItem.update({
          where: { id: result.routeItemId },
          data: { status: "visited" },
        });
      }

      return result;
    });

    return toVisitResponse(updatedVisit);
  }

  async cancelVisit(
    context: RequestContext,
    visitId: string,
    body: CancelVisitRequestBody,
  ): Promise<VisitResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanCancelVisit(context, visit.representativeUserId);

    if (visit.status === "completed" || visit.status === "cancelled") {
      throw new ConflictException({
        code: "VISIT_NOT_CANCELLABLE",
        message: "Only a draft or in-progress visit can be cancelled.",
      });
    }

    const reason = normalizeCancellationReason(body.reason);
    const comment = normalizeCancellationComment(body.comment);

    const cancelledVisit = await this.prisma.$transaction(async (tx) => {
      const result = await tx.visit.update({
        where: { id: visit.id },
        data: {
          status: "cancelled",
          cancelledAt: new Date(),
          cancellationReason: reason,
          cancellationComment: comment,
        },
        include: visitInclude,
      });

      if (result.routeItemId) {
        await tx.routeItem.update({
          where: { id: result.routeItemId },
          data: { status: "skipped", skipReason: reason },
        });
      }

      return result;
    });

    return toVisitResponse(cancelledVisit);
  }

  async addTextNote(
    context: RequestContext,
    visitId: string,
    body: AddTextVisitNoteRequestBody,
  ): Promise<VisitNoteResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanUpdateVisit(context, visit.representativeUserId);

    const textContent = normalizeRequiredString(body.textContent);

    if (!textContent) {
      throw new BadRequestException({
        code: "VISIT_NOTE_INVALID",
        message: "Text content is required.",
        fieldErrors: {
          textContent: ["Text content is required."],
        },
      });
    }

    if (!context.userId) {
      throwMissingVisitPermission();
    }

    const note = await this.prisma.visitNote.create({
      data: {
        tenantId: context.tenantId,
        visitId: visit.id,
        inputType: "text",
        textContent,
        createdByUserId: context.userId,
      },
    });

    return toVisitNoteResponse(note);
  }

  async registerTemporaryAudioUpload(
    context: RequestContext,
    visitId: string,
    body: RegisterAudioUploadRequestBody,
  ): Promise<RegisteredAudioUploadResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanUpdateVisit(context, visit.representativeUserId);

    if (!context.userId) {
      throwMissingVisitPermission();
    }

    const fileName = normalizeUploadFileName(body.fileName);
    const contentType = normalizeAudioContentType(body.contentType, fileName);
    const sizeBytes = normalizeAudioSizeBytes(body.sizeBytes);
    const checksum = normalizeOptionalString(body.checksum);

    if (!fileName || !contentType) {
      throw new BadRequestException({
        code: "AUDIO_UPLOAD_INVALID",
        message: "Audio file name and supported content type are required.",
        fieldErrors: {
          fileName: fileName ? [] : ["File name is required."],
          contentType: contentType
            ? []
            : ["Supported audio content type is required."],
        },
      });
    }

    const expiresAt = new Date(
      Date.now() + TEMPORARY_AUDIO_TTL_HOURS * 60 * 60 * 1000,
    );
    const objectKey = buildTemporaryAudioObjectKey(
      context.tenantId,
      visit.id,
      fileName,
    );
    const createdByUserId = context.userId;

    const result = await this.prisma.$transaction(async (tx) => {
      const storageObject = await tx.storageObject.create({
        data: {
          tenantId: context.tenantId,
          bucket: this.storageService?.getDefaultBucket() ?? "vizitum",
          objectKey,
          purpose: "temporary_audio",
          contentType,
          sizeBytes: sizeBytes === null ? null : BigInt(sizeBytes),
          checksum,
          status: "active",
          expiresAt,
          createdByUserId,
        },
      });
      const note = await tx.visitNote.create({
        data: {
          tenantId: context.tenantId,
          visitId: visit.id,
          inputType: "audio",
          temporaryAudioObjectId: storageObject.id,
          createdByUserId,
        },
      });

      return { note, storageObject };
    });

    const uploadUrl = this.storageService
      ? await this.storageService.createPresignedUploadUrl(
          context,
          result.storageObject.id,
        )
      : undefined;

    return {
      note: toVisitNoteResponse(result.note),
      storageObject: {
        id: result.storageObject.id,
        bucket: result.storageObject.bucket,
        objectKey: result.storageObject.objectKey,
        contentType: result.storageObject.contentType,
        sizeBytes: result.storageObject.sizeBytes?.toString() ?? null,
        checksum: result.storageObject.checksum,
        expiresAt:
          result.storageObject.expiresAt?.toISOString() ??
          expiresAt.toISOString(),
      },
      ...(uploadUrl
        ? {
            uploadUrl: {
              url: uploadUrl.url,
              method: "PUT",
              expiresAt: uploadUrl.expiresAt,
              headers: uploadUrl.headers,
            },
          }
        : {}),
    };
  }

  // Photo evidence for the "problem" exception on the field report. Same
  // register-then-presigned-PUT shape as the audio upload above (the bytes
  // never travel through a Server Action) and no `VisitNote` row.
  //
  // Registering is not the same as keeping: a rep who re-picks a photo,
  // collapses the problem panel or abandons the form leaves an object nothing
  // will ever reference. So a fresh registration starts with an `expiresAt`
  // like any temporary object and expires the visit's previous unreferenced
  // photo immediately (at most one in flight per visit, which is also what
  // bounds how much a single visit can upload). Confirming a report is what
  // makes the photo permanent — `confirmReport` clears the expiry of the one
  // object the report actually points at.
  async registerProblemPhotoUpload(
    context: RequestContext,
    visitId: string,
    body: RegisterProblemPhotoRequestBody,
  ): Promise<RegisteredProblemPhotoResponse> {
    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanUpdateVisit(context, visit.representativeUserId);

    if (!context.userId) {
      throwMissingVisitPermission();
    }

    const fileName = normalizeUploadFileName(body.fileName);
    const contentType = normalizePhotoContentType(body.contentType, fileName);
    const sizeBytes = normalizePhotoSizeBytes(body.sizeBytes);

    if (!fileName || !contentType) {
      throw new BadRequestException({
        code: "PHOTO_UPLOAD_INVALID",
        message: "Photo file name and supported content type are required.",
        fieldErrors: {
          fileName: fileName ? [] : ["File name is required."],
          contentType: contentType
            ? []
            : ["Supported image content type is required."],
        },
      });
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + UNCONFIRMED_PHOTO_TTL_HOURS * 60 * 60 * 1000,
    );
    const objectKeyPrefix = buildVisitPhotoPrefix(context.tenantId, visit.id);

    const storageObject = await this.prisma.$transaction(async (tx) => {
      // Only unclaimed photos still carry an expiry — a photo a confirmed
      // report already claimed has `expiresAt: null` and must survive a later
      // registration against the same visit.
      await tx.storageObject.updateMany({
        where: {
          tenantId: context.tenantId,
          purpose: "visit_attachment",
          status: "active",
          expiresAt: { not: null },
          objectKey: { startsWith: objectKeyPrefix },
        },
        data: { status: "expired", expiresAt: now },
      });

      return tx.storageObject.create({
        data: {
          tenantId: context.tenantId,
          bucket: this.storageService?.getDefaultBucket() ?? "vizitum",
          objectKey: `${objectKeyPrefix}${randomUUID()}/${fileName}`,
          purpose: "visit_attachment",
          contentType,
          sizeBytes: sizeBytes === null ? null : BigInt(sizeBytes),
          status: "active",
          expiresAt,
          createdByUserId: context.userId,
        },
      });
    });

    const uploadUrl = this.storageService
      ? await this.storageService.createPresignedUploadUrl(
          context,
          storageObject.id,
        )
      : undefined;

    return {
      storageObject: {
        id: storageObject.id,
        bucket: storageObject.bucket,
        objectKey: storageObject.objectKey,
        contentType: storageObject.contentType,
        sizeBytes: storageObject.sizeBytes?.toString() ?? null,
      },
      ...(uploadUrl
        ? {
            uploadUrl: {
              url: uploadUrl.url,
              method: "PUT" as const,
              expiresAt: uploadUrl.expiresAt,
              headers: uploadUrl.headers,
            },
          }
        : {}),
    };
  }

  async confirmReport(
    context: RequestContext,
    visitId: string,
    body: ConfirmReportRequestBody,
  ): Promise<ReportResponse> {
    if (!context.permissions.includes(PERMISSIONS.REPORTS_CONFIRM_OWN)) {
      throwMissingVisitPermission();
    }

    const visit = await this.findTenantVisit(context.tenantId, visitId);

    this.assertCanUpdateVisit(context, visit.representativeUserId);

    // Confirming flips the visit to `completed` (and the route item to
    // `visited`), which must never resurrect a cancelled visit.
    if (visit.status === "cancelled") {
      throw new ConflictException({
        code: "VISIT_NOT_ACTIVE",
        message: "A cancelled visit cannot receive a confirmed report.",
      });
    }

    if (!context.userId) {
      throwMissingVisitPermission();
    }

    const confirmedByUserId = context.userId;
    const confirmedData = normalizeJsonObject(body.confirmedData);
    const schemaVersion =
      normalizeRequiredString(body.schemaVersion) ?? "manual.v1";

    if (!confirmedData) {
      throw new BadRequestException({
        code: "REPORT_INVALID",
        message: "Confirmed report data is required.",
        fieldErrors: {
          confirmedData: ["Confirmed report data must be a JSON object."],
        },
      });
    }

    if (schemaVersion === "field-report.v1") {
      assertVisitDateInWindow(confirmedData);
    }

    const clientRequestId = normalizeClientRequestId(body.clientRequestId);

    // A replay of a confirm whose answer the device never heard — the ordinary
    // outcome of confirming a report with no signal. Returned exactly as the
    // first attempt left it, because re-running the work below is not harmless:
    // it would stamp a new `confirmedAt` (hours later, for a rep who was offline
    // when they actually finished the visit) and replace this report's tasks
    // with fresh rows, discarding whatever a manager had already done with the
    // originals.
    if (clientRequestId) {
      const replayed = await this.findReportByClientRequestId(
        context.tenantId,
        clientRequestId,
      );

      if (replayed) {
        assertReplayBelongsToVisit(replayed.visitId, visit.id);

        return toReportResponse(
          replayed,
          await findReportCreatedTasks(
            this.prisma,
            context.tenantId,
            replayed.id,
          ),
        );
      }
    }

    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: context.tenantId },
      select: { segmentTemplate: true },
    });

    if (!tenant) {
      throw new BadRequestException({
        code: "TENANT_INVALID",
        message: "Tenant could not be resolved.",
      });
    }

    const confirmOnce = () =>
      this.prisma.$transaction(async (tx) => {
        const confirmedAt = new Date();
        const result = await tx.report.upsert({
          where: { visitId: visit.id },
          create: {
            tenantId: context.tenantId,
            visitId: visit.id,
            locationId: visit.locationId,
            representativeUserId: visit.representativeUserId,
            templateCode: tenant.segmentTemplate,
            schemaVersion,
            status: "confirmed",
            confirmedData,
            confirmedByUserId,
            confirmedAt,
            clientRequestId,
            aiMetadata: {
              source: "manual_text",
            },
          },
          update: {
            schemaVersion,
            status: "confirmed",
            confirmedData,
            confirmedByUserId,
            confirmedAt,
            // The report carries the token of whichever confirm last wrote it, so
            // a deliberate re-confirm (a rep correcting a report) becomes the new
            // owner and a replay of the older token falls through to a normal
            // confirm — which is what it did before any of this existed.
            clientRequestId,
            aiMetadata: {
              source: "manual_text",
            },
          },
        });

        await tx.visit.update({
          where: { id: visit.id },
          data: {
            status: "completed",
            completedAt: visit.completedAt ?? confirmedAt,
          },
        });

        if (visit.routeItemId) {
          await tx.routeItem.update({
            where: { id: visit.routeItemId },
            data: { status: "visited" },
          });
        }

        // The shelf check is the only writer of assortment shelf state, so it
        // rides the confirm transaction: a report that exists and coverage that
        // ignores it would be worse than either alone.
        const shelfCheck = extractShelfCheck(confirmedData, confirmedAt);

        if (shelfCheck) {
          await applyShelfCheck(
            tx,
            context.tenantId,
            visit.locationId,
            shelfCheck,
          );
        }

        // Same `confirmedData.tasksToCreate` contract as the AI-draft confirm
        // flow (ai.service.ts) — reused so the field-report form's "tasks for
        // the next visit" block creates real Task rows the same way. Only
        // touch tasks when the payload actually carries some: this keeps a
        // resubmit idempotent (old ones tied to this report are replaced)
        // without deleting anything for schemas that never set this field
        // (e.g. manual.v1).
        const tasksToCreate = extractTasksToCreate(confirmedData);

        if (tasksToCreate.length > 0) {
          await tx.task.deleteMany({
            where: {
              tenantId: context.tenantId,
              reportId: result.id,
            },
          });

          await tx.task.createMany({
            data: tasksToCreate.map((task) => ({
              tenantId: context.tenantId,
              title: task.title,
              description: task.description,
              isPriority: task.isPriority,
              assignedToUserId:
                task.assignee === "representative"
                  ? visit.representativeUserId
                  : null,
              createdByUserId: confirmedByUserId,
              locationId: visit.locationId,
              visitId: visit.id,
              reportId: result.id,
              dueDate: task.dueDate,
            })),
          });
        }

        // The problem photo was registered with an expiry so an abandoned or
        // re-picked upload gets collected. Confirming the report is what makes
        // the one object it actually references permanent — scoped to this
        // tenant and this visit's own prefix so a payload can't adopt someone
        // else's object by id.
        const problemPhotoObjectId = problemPhotoObjectIdOf(confirmedData);

        if (problemPhotoObjectId) {
          await tx.storageObject.updateMany({
            where: {
              id: problemPhotoObjectId,
              tenantId: context.tenantId,
              purpose: "visit_attachment",
              objectKey: {
                startsWith: buildVisitPhotoPrefix(context.tenantId, visit.id),
              },
            },
            data: { status: "active", expiresAt: null },
          });
        }

        return result;
      });

    let report: Awaited<ReturnType<typeof confirmOnce>>;

    try {
      report = await confirmOnce();
    } catch (error) {
      // Two flushes of the same queued confirm can slip past the replay check
      // above together; the unique index is what actually decides between them.
      // The loser should get the winner's report rather than a 500 it would only
      // retry into.
      const raced =
        clientRequestId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
          ? await this.findReportByClientRequestId(
              context.tenantId,
              clientRequestId,
            )
          : null;

      if (!raced) {
        throw error;
      }

      assertReplayBelongsToVisit(raced.visitId, visit.id);
      report = raced;
    }

    const createdTasks = await findReportCreatedTasks(
      this.prisma,
      context.tenantId,
      report.id,
    );

    return toReportResponse(report, createdTasks);
  }

  private async findReportByClientRequestId(
    tenantId: string,
    clientRequestId: string,
  ) {
    // The token is scoped to the tenant, which comes from the request context —
    // never from the payload carrying the token.
    return this.prisma.report.findUnique({
      where: { tenantId_clientRequestId: { tenantId, clientRequestId } },
    });
  }

  private async findTenantVisit(
    tenantId: string,
    visitId: string,
  ): Promise<VisitWithRelations> {
    const visit = await this.prisma.visit.findFirst({
      where: {
        id: visitId,
        tenantId,
      },
      include: visitInclude,
    });

    if (!visit) {
      throw new NotFoundException({
        code: "VISIT_NOT_FOUND",
        message: "Visit was not found.",
      });
    }

    return visit;
  }

  private assertCanReadVisit(
    context: RequestContext,
    representativeUserId: string,
  ): void {
    if (context.permissions.includes(PERMISSIONS.VISITS_READ_TEAM)) {
      return;
    }

    if (
      context.permissions.includes(PERMISSIONS.VISITS_READ_OWN) &&
      context.userId === representativeUserId
    ) {
      return;
    }

    throwMissingVisitPermission();
  }

  private assertCanReadReport(
    context: RequestContext,
    representativeUserId: string,
  ): void {
    if (context.permissions.includes(PERMISSIONS.REPORTS_READ_TEAM)) {
      return;
    }

    if (
      context.permissions.includes(PERMISSIONS.REPORTS_READ_OWN) &&
      context.userId === representativeUserId
    ) {
      return;
    }

    throwMissingVisitPermission();
  }

  private assertCanCreateVisitForRepresentative(
    context: RequestContext,
    representativeUserId: string,
  ): void {
    if (context.userId === representativeUserId) {
      return;
    }

    throw new ForbiddenException({
      code: "VISIT_SCOPE_FORBIDDEN",
      message: "You cannot create a visit for this representative.",
    });
  }

  private assertCanUpdateVisit(
    context: RequestContext,
    representativeUserId: string,
  ): void {
    if (
      context.permissions.includes(PERMISSIONS.VISITS_UPDATE_OWN) &&
      context.userId === representativeUserId
    ) {
      return;
    }

    throwMissingVisitPermission();
  }

  private assertCanCancelVisit(
    context: RequestContext,
    representativeUserId: string,
  ): void {
    if (
      context.permissions.includes(PERMISSIONS.VISITS_CANCEL_OWN) &&
      context.userId === representativeUserId
    ) {
      return;
    }

    throwMissingVisitPermission();
  }

  private async assertFieldRepresentative(
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const representative = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
        status: "active",
        roles: {
          some: {
            tenantId,
            roleCode: "field_representative",
          },
        },
      },
      select: { id: true },
    });

    if (!representative) {
      throw new BadRequestException({
        code: "REPRESENTATIVE_INVALID",
        message: "Representative must be an active field representative.",
      });
    }
  }

  private async assertTenantLocation(
    tenantId: string,
    locationId: string,
  ): Promise<void> {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!location) {
      throw new BadRequestException({
        code: "LOCATION_INVALID",
        message: "Location must exist in this tenant.",
      });
    }
  }

  private async assertRouteItemMatchesVisit(
    tenantId: string,
    routeItemId: string,
    locationId: string,
    representativeUserId: string,
  ): Promise<void> {
    const routeItem = await this.prisma.routeItem.findFirst({
      where: {
        id: routeItemId,
        tenantId,
        locationId,
        routePlan: {
          tenantId,
          representativeUserId,
        },
      },
      select: { id: true },
    });

    if (!routeItem) {
      throw new BadRequestException({
        code: "ROUTE_ITEM_INVALID",
        message: "Route item must match the visit representative and location.",
      });
    }
  }
}

const visitInclude = {
  location: true,
  representative: true,
} satisfies Prisma.VisitInclude;

// Shared by buildVisitWhere (the ORM path listVisits uses) and
// getVisitDaySummary's raw-SQL conditions above — the representative/tenant
// scoping this derives must never drift between the two, so it lives once.
function resolveVisitRepresentativeFilter(
  context: RequestContext,
  query: Pick<ListVisitsQuery, "representativeUserId">,
): string | null {
  const requestedRepresentativeId = normalizeId(query.representativeUserId);
  const canReadTeam = context.permissions.includes(
    PERMISSIONS.VISITS_READ_TEAM,
  );
  const canReadOwn = context.permissions.includes(PERMISSIONS.VISITS_READ_OWN);
  const representativeFilter = canReadTeam
    ? requestedRepresentativeId
    : canReadOwn
      ? context.userId
      : null;

  if (!canReadTeam && !representativeFilter) {
    throwMissingVisitPermission();
  }

  return representativeFilter ?? null;
}

function buildVisitWhere(
  context: RequestContext,
  query: ListVisitsQuery,
  // Passed in rather than derived here so a caller that builds two WHEREs for
  // one request (the list and its status totals) pins both to one window.
  startedAtRange: VisitPeriodRange = resolveVisitPeriodRange(
    query.startedFrom,
    query.startedTo,
  ),
): Prisma.VisitWhereInput {
  const representativeFilter = resolveVisitRepresentativeFilter(context, query);

  return {
    tenantId: context.tenantId,
    ...(representativeFilter
      ? { representativeUserId: representativeFilter }
      : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.routePlanId
      ? {
          routeItem: {
            tenantId: context.tenantId,
            routePlanId: query.routePlanId,
          },
        }
      : {}),
    ...(query.status && query.status.length > 0
      ? {
          status:
            query.status.length === 1 ? query.status[0] : { in: query.status },
        }
      : {}),
    // A never-started draft (startedAt: null) has no startedAt to fall in the
    // period, so without this fallback it would silently disappear from any
    // date-filtered caller of this shared query — the field history list and
    // its "needs follow-up" counter, the day-summary aggregate, and the
    // manager visit list all build their WHERE clause through
    // buildVisitWhere, not just field history. Falling back to createdAt
    // mirrors the field history frontend's own `startedAt ?? createdAt`
    // day-grouping key, so every consumer of this endpoint agrees on the
    // same set of visits.
    //
    // Wrapped in AND rather than spread as a bare top-level `OR`: a future
    // filter that also needs its own OR condition would silently overwrite
    // this one otherwise, since object-spread keeps only the last value
    // written to a given key.
    AND: [
      {
        OR: [
          { startedAt: startedAtRange },
          { startedAt: null, createdAt: startedAtRange },
        ],
      },
    ],
  };
}

// The longest a single window may be — a cost ceiling on one request, not a
// horizon on the data. Without it, a caller that sends no period at all makes
// the list count and the day-summary GROUP BY sweep a tenant's entire visit
// history, and the frontend is not the place to enforce that, since an old
// client, a saved link or a script can all skip it.
//
// Note what this deliberately does *not* do: it never moves a window forward
// in time. `startedFrom=2020-01-01&startedTo=2020-06-30` is six months long,
// so it passes untouched and returns 2020 — nothing ages out of reach, and a
// rep who wants the year before last simply names that range. Only the length
// is capped, measured back from the window's own end.
//
// Clamped rather than rejected: a request for "everything" still answers, it
// just answers for one year's worth, so no existing caller breaks.
export const VISIT_PERIOD_MAX_MONTHS = 12;

// Always bounded below, so every consumer can name the window it is showing.
export type VisitPeriodRange = { gte: Date; lte?: Date };

// The requested period, trimmed to at most VISIT_PERIOD_MAX_MONTHS measured
// back from its own upper bound (or from now, when the caller named no end).
// A window that is already short enough passes through wherever it points.
//
// The floor lands on the *start* of that day. Every other bound in this filter
// is a whole calendar day — `startedTo` becomes 23:59:59.999 — so subtracting
// twelve months from an end bound would otherwise put the floor at 23:59:59.999
// too and swallow all but the last millisecond of the boundary day, which is a
// day of visits that silently doesn't exist.
export function resolveVisitPeriodRange(
  fromValue: unknown,
  toValue: unknown,
  now: Date = new Date(),
): VisitPeriodRange {
  const range = buildDateTimeRangeFilter(fromValue, toValue);
  const windowEnd = range?.lte ?? now;
  const earliest = startOfUtcDay(
    subtractMonths(windowEnd, VISIT_PERIOD_MAX_MONTHS),
  );
  const gte =
    range?.gte && range.gte.getTime() > earliest.getTime()
      ? range.gte
      : earliest;

  return { gte, ...(range?.lte ? { lte: range.lte } : {}) };
}

function subtractMonths(value: Date, months: number): Date {
  const shifted = new Date(value.getTime());

  shifted.setUTCMonth(shifted.getUTCMonth() - months);

  return shifted;
}

function startOfUtcDay(value: Date): Date {
  const start = new Date(value.getTime());

  start.setUTCHours(0, 0, 0, 0);

  return start;
}

function toVisitPeriodResponse(range: VisitPeriodRange): VisitPeriodResponse {
  return {
    startedFrom: range.gte.toISOString(),
    startedTo: range.lte ? range.lte.toISOString() : null,
  };
}

// `draft` is a real VisitStatus but nothing in the product ever leaves a visit
// there, so it has no counter of its own — it still rides along in `total`,
// which is the period's whole count rather than a sum of the three named ones.
function toVisitStatusTotals(
  groups: Array<{ status: VisitStatus; _count: { _all: number } }>,
): VisitStatusTotals {
  const countOf = (status: VisitStatus) =>
    groups.find((group) => group.status === status)?._count._all ?? 0;

  return {
    total: groups.reduce((sum, group) => sum + group._count._all, 0),
    completed: countOf("completed"),
    inProgress: countOf("in_progress"),
    cancelled: countOf("cancelled"),
  };
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

function normalizeOptionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return normalizeId(value);
}

// An idempotency token is opaque — the server never parses it, only matches it —
// so the only rules are that it is a non-empty string and short enough to sit in
// an index. Anything else is a client bug worth reporting rather than silently
// dropping, since dropping it would quietly turn a safe retry into a duplicate
// confirm.
function normalizeClientRequestId(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  // Anything that is not a string fails the emptiness check below rather than
  // being coerced: a token is matched byte for byte, so a coerced one would
  // silently become a different token than the client thinks it sent.
  const normalizedValue = typeof value === "string" ? value.trim() : "";

  if (
    !normalizedValue ||
    normalizedValue.length > MAX_CLIENT_REQUEST_ID_LENGTH
  ) {
    throw new BadRequestException({
      code: "REPORT_REQUEST_ID_INVALID",
      message: "Confirmation token must be a short non-empty string.",
      fieldErrors: {
        clientRequestId: [
          `Confirmation token must be a non-empty string of at most ${MAX_CLIENT_REQUEST_ID_LENGTH} characters.`,
        ],
      },
    });
  }

  return normalizedValue;
}

// One token belongs to one confirm of one visit. A token that already produced
// a report for a different visit means the device is reusing it — replaying that
// other visit's report as this one's would be worse than any error.
function assertReplayBelongsToVisit(
  replayedVisitId: string,
  visitId: string,
): void {
  if (replayedVisitId === visitId) {
    return;
  }

  throw new ConflictException({
    code: "REPORT_REQUEST_ID_REUSED",
    message: "This confirmation token was already used for another visit.",
  });
}

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

// The visit date in a `field-report.v1` confirmation is client-supplied and
// only meaningful near the confirm: it exists so a rep can log yesterday's
// forgotten visit, not to reconstruct history. Bounds are checked against the
// server's UTC date with a ±1 day grace — the widest real timezone offset is
// under 24h, so the grace absorbs every midnight/timezone skew without a
// tenant-timezone lookup, and the frontend's stricter local-time bounds mean
// an honest client never trips this.
function assertVisitDateInWindow(confirmedData: Prisma.InputJsonObject): void {
  const fieldReport = (confirmedData as Record<string, unknown>).fieldReport;

  if (!isRecord(fieldReport)) {
    return;
  }

  const visitDate = fieldReport.visitDate;

  // Absent stays legal: older clients and drafts never sent one.
  if (visitDate === undefined || visitDate === null) {
    return;
  }

  const rejectVisitDate = (message: string): never => {
    throw new BadRequestException({
      code: "REPORT_INVALID",
      message,
      fieldErrors: { visitDate: [message] },
    });
  };

  const parsed = parseDateOnly(visitDate);
  const parsedMs = parsed
    ? parsed.getTime()
    : rejectVisitDate("Visit date must be a valid YYYY-MM-DD date.");

  const dayMs = 24 * 60 * 60 * 1000;
  // parseDateOnly pins the date to UTC midnight, so flooring "now" to the
  // day makes both sides whole days apart.
  const utcTodayMs = Math.floor(Date.now() / dayMs) * dayMs;

  if (parsedMs > utcTodayMs + dayMs) {
    rejectVisitDate("Visit date cannot be in the future.");
  }

  if (parsedMs < utcTodayMs - (VISIT_DATE_BACKDATE_WINDOW_DAYS + 1) * dayMs) {
    rejectVisitDate(
      `Visit date cannot be more than ${VISIT_DATE_BACKDATE_WINDOW_DAYS} days ago.`,
    );
  }
}

function normalizeJsonObject(value: unknown): Prisma.InputJsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

function normalizeUploadFileName(value: unknown): string | null {
  const normalizedValue = normalizeRequiredString(value);

  if (!normalizedValue) {
    return null;
  }

  return (
    normalizedValue
      .replaceAll("\\", "/")
      .split("/")
      .at(-1)
      ?.replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120) || null
  );
}

function normalizeAudioContentType(
  value: unknown,
  fileName?: string | null,
): string | null {
  const normalizedValue = normalizeRequiredString(value)?.toLowerCase();
  const aliasedValue = normalizedValue
    ? (AUDIO_CONTENT_TYPE_ALIASES.get(normalizedValue) ?? normalizedValue)
    : null;

  if (aliasedValue && SUPPORTED_AUDIO_CONTENT_TYPES.has(aliasedValue)) {
    return aliasedValue;
  }

  return normalizeAudioContentTypeFromFileName(fileName);
}

function normalizeAudioContentTypeFromFileName(
  fileName: string | null | undefined,
): string | null {
  const extension = fileName?.split(".").pop()?.toLowerCase();

  if (extension === "mp3") {
    return "audio/mpeg";
  }

  if (extension === "m4a" || extension === "mp4" || extension === "aac") {
    return "audio/mp4";
  }

  if (extension === "wav") {
    return "audio/wav";
  }

  if (extension === "webm") {
    return "audio/webm";
  }

  return null;
}

function normalizeAudioSizeBytes(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsedValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue <= 0 ||
    parsedValue > MAX_TEMPORARY_AUDIO_SIZE_BYTES
  ) {
    throw new BadRequestException({
      code: "AUDIO_UPLOAD_SIZE_INVALID",
      message: "Audio size must be a positive integer up to 50 MB.",
      fieldErrors: {
        sizeBytes: ["Audio size must be a positive integer up to 50 MB."],
      },
    });
  }

  return parsedValue;
}

function normalizePhotoContentType(
  value: unknown,
  fileName?: string | null,
): string | null {
  const normalizedValue = normalizeRequiredString(value)?.toLowerCase();
  const aliasedValue = normalizedValue
    ? (PHOTO_CONTENT_TYPE_ALIASES.get(normalizedValue) ?? normalizedValue)
    : null;

  if (aliasedValue && SUPPORTED_PHOTO_CONTENT_TYPES.has(aliasedValue)) {
    return aliasedValue;
  }

  return normalizePhotoContentTypeFromFileName(fileName);
}

function normalizePhotoContentTypeFromFileName(
  fileName: string | null | undefined,
): string | null {
  const extension = fileName?.split(".").pop()?.toLowerCase();

  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }

  if (extension === "png") {
    return "image/png";
  }

  if (extension === "webp") {
    return "image/webp";
  }

  if (extension === "heic") {
    return "image/heic";
  }

  if (extension === "heif") {
    return "image/heif";
  }

  return null;
}

function normalizePhotoSizeBytes(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsedValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue <= 0 ||
    parsedValue > MAX_PROBLEM_PHOTO_SIZE_BYTES
  ) {
    throw new BadRequestException({
      code: "PHOTO_UPLOAD_SIZE_INVALID",
      message: "Photo size must be a positive integer up to 10 MB.",
      fieldErrors: {
        sizeBytes: ["Photo size must be a positive integer up to 10 MB."],
      },
    });
  }

  return parsedValue;
}

// Digs `fieldReport.problem.photoObjectId` out of the freeform confirmed
// payload. Everything below the top level is unvalidated JSON, so each step
// is checked rather than cast.
function problemPhotoObjectIdOf(
  confirmedData: Prisma.InputJsonObject,
): string | null {
  const fieldReport = isPlainRecord(confirmedData)
    ? confirmedData.fieldReport
    : undefined;

  if (!isPlainRecord(fieldReport)) {
    return null;
  }

  const problem = (fieldReport as Record<string, unknown>).problem;

  if (!isPlainRecord(problem)) {
    return null;
  }

  const photoObjectId = problem.photoObjectId;

  return typeof photoObjectId === "string" && photoObjectId
    ? photoObjectId
    : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Every photo for one visit shares this prefix, which is also how a
// re-registration finds the visit's earlier photos to expire.
function buildVisitPhotoPrefix(tenantId: string, visitId: string): string {
  return ["tenants", tenantId, "visits", visitId, "photos", ""].join("/");
}

function buildTemporaryAudioObjectKey(
  tenantId: string,
  visitId: string,
  fileName: string,
): string {
  return [
    "tenants",
    tenantId,
    "visits",
    visitId,
    "audio",
    randomUUID(),
    fileName,
  ].join("/");
}

// `cancelled` is deliberately absent: updateVisit rejects it before calling
// this, so cancelVisit stays the only path into the cancelled status.
function normalizeVisitStatus(value: unknown): VisitStatus | null {
  if (value === "draft" || value === "in_progress" || value === "completed") {
    return value;
  }

  return null;
}

function normalizeCancellationReason(value: unknown): VisitCancellationReason {
  const reason = VISIT_CANCELLATION_REASONS.find((item) => item === value);

  if (!reason) {
    const message = `Cancellation reason must be one of: ${VISIT_CANCELLATION_REASONS.join(", ")}.`;

    throw new BadRequestException({
      code: "CANCELLATION_REASON_INVALID",
      message,
      fieldErrors: {
        reason: [message],
      },
    });
  }

  return reason;
}

function normalizeCancellationComment(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new BadRequestException({
      code: "CANCELLATION_COMMENT_INVALID",
      message: "Cancellation comment must be a string.",
    });
  }

  const comment = value.trim();

  if (!comment) {
    return null;
  }

  if (comment.length > MAX_VISIT_CANCELLATION_COMMENT_LENGTH) {
    throw new BadRequestException({
      code: "CANCELLATION_COMMENT_TOO_LONG",
      message: `Cancellation comment must be at most ${MAX_VISIT_CANCELLATION_COMMENT_LENGTH} characters.`,
    });
  }

  return comment;
}

function parseOptionalDateTime(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new BadRequestException({
      code: "DATETIME_INVALID",
      message: "Date time value must be an ISO string.",
    });
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      code: "DATETIME_INVALID",
      message: "Date time value must be an ISO string.",
    });
  }

  return date;
}

// Untyped against a specific Prisma filter interface (rather than
// `Prisma.DateTimeNullableFilter`) so the same range literal can be reused
// as-is for both the nullable `startedAt` field and the non-nullable
// `createdAt` field in buildVisitWhere's fallback OR.
function buildDateTimeRangeFilter(
  fromValue: unknown,
  toValue: unknown,
): { gte?: Date; lte?: Date } | undefined {
  const gte = parseDateOnlyBoundary(fromValue, "start");
  const lte = parseDateOnlyBoundary(toValue, "end");

  if (!gte && !lte) {
    return undefined;
  }

  return {
    ...(gte ? { gte } : {}),
    ...(lte ? { lte } : {}),
  };
}

function parseDateOnlyBoundary(
  value: unknown,
  boundary: "start" | "end",
): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException({
      code: "DATE_INVALID",
      message: "Date filters must use YYYY-MM-DD format.",
    });
  }

  const suffix = boundary === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
  const date = new Date(`${value}${suffix}`);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      code: "DATE_INVALID",
      message: "Date filters must use YYYY-MM-DD format.",
    });
  }

  return date;
}

function toVisitResponse(visit: VisitWithRelations): VisitResponse {
  return {
    id: visit.id,
    locationId: visit.locationId,
    location: {
      id: visit.location.id,
      name: visit.location.name,
      addressLine: visit.location.addressLine,
      city: visit.location.city,
    },
    representativeUserId: visit.representativeUserId,
    representative: {
      id: visit.representative.id,
      email: visit.representative.email,
      name: visit.representative.name,
    },
    routeItemId: visit.routeItemId,
    visitType: visit.visitType,
    status: visit.status,
    startedAt: visit.startedAt?.toISOString() ?? null,
    completedAt: visit.completedAt?.toISOString() ?? null,
    cancelledAt: visit.cancelledAt?.toISOString() ?? null,
    cancellationReason: visit.cancellationReason,
    cancellationComment: visit.cancellationComment,
    createdAt: visit.createdAt.toISOString(),
    updatedAt: visit.updatedAt.toISOString(),
  };
}

function toVisitNoteResponse(note: {
  id: string;
  visitId: string;
  inputType: "text" | "audio";
  textContent: string | null;
  temporaryAudioObjectId?: string | null;
  createdByUserId: string;
  createdAt: Date;
}): VisitNoteResponse {
  return {
    id: note.id,
    visitId: note.visitId,
    inputType: note.inputType,
    textContent: note.textContent,
    temporaryAudioObjectId: note.temporaryAudioObjectId ?? null,
    createdByUserId: note.createdByUserId,
    createdAt: note.createdAt.toISOString(),
  };
}

function throwMissingVisitPermission(): never {
  throw new ForbiddenException({
    code: "VISIT_SCOPE_FORBIDDEN",
    message: "You cannot access this visit.",
  });
}
