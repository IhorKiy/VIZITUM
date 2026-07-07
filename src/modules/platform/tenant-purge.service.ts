import { Injectable } from "@nestjs/common";
import type { PlatformTenant } from "@prisma/client";

import { MILLISECONDS_PER_DAY } from "../../common/time";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

export const DEFAULT_TENANT_PURGE_RETENTION_DAYS = 30;

const DELETE_BATCH_SIZE = 500;

/**
 * Retention window between archiving a tenant and the worker purging it.
 * `0` is allowed (immediate eligibility — useful for local drills); anything
 * that is not a non-negative integer makes the worker refuse to run rather
 * than fall back to a default: purge is the one irreversible operation in
 * the system, so a misconfigured environment must never silently delete.
 */
export function resolveTenantPurgeRetentionDays(
  value: string | undefined,
): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_TENANT_PURGE_RETENTION_DAYS;
  }

  const parsed = Number(value.trim());

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `TENANT_PURGE_RETENTION_DAYS must be a non-negative integer, got "${value}".`,
    );
  }

  return parsed;
}

/**
 * Auto-archive of inactive pilot tenants is opt-in: unset (or empty) means
 * disabled. `0` is rejected — it would archive every pilot the moment it is
 * created — as is anything that is not a positive integer.
 */
export function resolvePilotAutoArchiveDays(
  value: string | undefined,
): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }

  const parsed = Number(value.trim());

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `TENANT_PILOT_AUTO_ARCHIVE_DAYS must be a positive integer (or unset to disable), got "${value}".`,
    );
  }

  return parsed;
}

/**
 * Minimal structural view of a Prisma delegate for a tenant-owned model —
 * just enough to page ids by tenant and delete them in batches.
 */
type TenantOwnedDelegate = {
  findMany(args: {
    where: { tenantId: string };
    select: { id: true };
    orderBy: { id: "asc" };
    take: number;
  }): Promise<Array<{ id: string }>>;
  deleteMany(args: {
    where: { id: { in: string[] } };
  }): Promise<{ count: number }>;
};

export type TenantPurgeOutcome = {
  tenantId: string;
  slug: string;
  outcome: "purged" | "skipped" | "storage_failed";
  storageObjectCount?: number;
  rowCounts?: Record<string, number>;
};

export type TenantPurgeRunResult = {
  scannedTenantCount: number;
  purgedTenantCount: number;
  skippedTenantCount: number;
  failedTenantCount: number;
  tenants: TenantPurgeOutcome[];
};

export type PilotAutoArchiveResult = {
  enabled: boolean;
  scannedTenantCount: number;
  archivedTenantCount: number;
};

@Injectable()
export class TenantPurgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Archives `pilot` tenants with no activity for `autoArchiveDays` days, so
   * abandoned pilots flow into the normal archive → retention → purge
   * pipeline. Disabled when `autoArchiveDays` is null (env var unset).
   *
   * "Activity" is the latest of what the schema can answer cheaply per
   * tenant: session `lastSeenAt`/`createdAt`, visit `updatedAt` and import
   * job `createdAt`, floored at the tenant's own `createdAt` so a fresh
   * pilot is never archived before the window has elapsed since creation.
   */
  async autoArchiveStalePilots(
    now: Date,
    options: { autoArchiveDays: number | null },
  ): Promise<PilotAutoArchiveResult> {
    if (options.autoArchiveDays === null) {
      return { enabled: false, scannedTenantCount: 0, archivedTenantCount: 0 };
    }

    const cutoff = new Date(
      now.getTime() - options.autoArchiveDays * MILLISECONDS_PER_DAY,
    );
    // createdAt <= cutoff is both the cheap pre-filter and the activity
    // floor: a pilot younger than the window can never be stale.
    const candidates = await this.prisma.platformTenant.findMany({
      where: { status: "pilot", createdAt: { lte: cutoff } },
      orderBy: { createdAt: "asc" },
    });

    let archivedTenantCount = 0;

    for (const tenant of candidates) {
      const lastActivityAt = await this.resolveLastPilotActivityAt(tenant);

      if (lastActivityAt > cutoff) {
        continue;
      }

      // Conditional on status still being "pilot": if the platform owner
      // concurrently changed the plan, suspended or archived the tenant,
      // this matches zero rows and we skip without emitting an event.
      const { count } = await this.prisma.platformTenant.updateMany({
        where: { id: tenant.id, status: "pilot" },
        data: { status: "archived", archivedAt: now },
      });

      if (count === 0) {
        continue;
      }

      archivedTenantCount += 1;
      await this.prisma.platformOperationEvent.create({
        data: {
          tenantId: tenant.id,
          eventType: "tenant.auto_archived",
          metadata: {
            slug: tenant.slug,
            name: tenant.name,
            previousStatus: "pilot",
            lastActivityAt: lastActivityAt.toISOString(),
            autoArchiveDays: options.autoArchiveDays,
          },
        },
      });
    }

    return {
      enabled: true,
      scannedTenantCount: candidates.length,
      archivedTenantCount,
    };
  }

  /**
   * Purges every eligible tenant: `archived` AND (an interrupted purge to
   * resume, an explicit purge request, or the retention window elapsed).
   * Non-archived tenants are never eligible — `purgeRequestedAt` cannot
   * outlive an unarchive (unarchiveTenant clears it), but the status filter
   * stays as a belt-and-braces guard anyway.
   */
  async purgeEligibleTenants(
    now: Date,
    options: { retentionDays: number },
  ): Promise<TenantPurgeRunResult> {
    const cutoff = new Date(
      now.getTime() - options.retentionDays * MILLISECONDS_PER_DAY,
    );
    const candidates = await this.prisma.platformTenant.findMany({
      where: {
        status: "archived",
        OR: [
          // Crash-safety: a purge that started but never finished is always
          // picked up again, regardless of retention math.
          { purgeStartedAt: { not: null } },
          { purgeRequestedAt: { not: null } },
          { archivedAt: { not: null, lte: cutoff } },
        ],
      },
      orderBy: { archivedAt: "asc" },
    });

    const tenants: TenantPurgeOutcome[] = [];

    for (const tenant of candidates) {
      tenants.push(await this.purgeTenant(tenant, now));
    }

    return {
      scannedTenantCount: candidates.length,
      purgedTenantCount: tenants.filter((t) => t.outcome === "purged").length,
      skippedTenantCount: tenants.filter((t) => t.outcome === "skipped").length,
      failedTenantCount: tenants.filter((t) => t.outcome === "storage_failed")
        .length,
      tenants,
    };
  }

  private async purgeTenant(
    tenant: PlatformTenant,
    now: Date,
  ): Promise<TenantPurgeOutcome> {
    if (!tenant.purgeStartedAt) {
      // Point of no return, claimed atomically: conditional on the tenant
      // still being archived and unclaimed. If a concurrent unarchive (or
      // another worker) won the race, this matches zero rows and we refuse
      // to touch the tenant. Once purgeStartedAt is set, unarchiveTenant
      // rejects the tenant, so a partially-purged tenant can never come
      // back half-visible.
      const { count } = await this.prisma.platformTenant.updateMany({
        where: { id: tenant.id, status: "archived", purgeStartedAt: null },
        data: { purgeStartedAt: now },
      });

      if (count === 0) {
        return { tenantId: tenant.id, slug: tenant.slug, outcome: "skipped" };
      }

      await this.prisma.platformOperationEvent.create({
        data: {
          tenantId: tenant.id,
          eventType: "tenant.purge_started",
          metadata: {
            slug: tenant.slug,
            name: tenant.name,
            reason: tenant.purgeRequestedAt
              ? "purge_requested"
              : "retention_elapsed",
            archivedAt: tenant.archivedAt?.toISOString() ?? null,
            purgeRequestedAt: tenant.purgeRequestedAt?.toISOString() ?? null,
          },
        },
      });
    }

    // Storage before rows: a dangling DB row is recoverable on the next
    // run, an orphaned R2 object is silent cost forever. Any storage
    // failure aborts this tenant's purge with all rows intact — the tenant
    // stays claimed (purgeStartedAt set) and is retried on the next run.
    const storage = await this.storageService.deleteAllTenantObjects(
      tenant.id,
      now,
    );

    if (storage.failedObjectCount > 0) {
      return {
        tenantId: tenant.id,
        slug: tenant.slug,
        outcome: "storage_failed",
        storageObjectCount: storage.deletedObjectCount,
      };
    }

    // Each table is deleted in id-ordered batches, each batch its own
    // implicit transaction: a crash leaves committed batches behind and the
    // next run continues where this one stopped (deletes are idempotent).
    // Counts therefore reflect what *this run* deleted, which on a resumed
    // purge is less than the tenant ever contained.
    const rowCounts: Record<string, number> = {};

    for (const { table, delegate } of this.tenantOwnedDeletionOrder()) {
      rowCounts[table] = await this.deleteTenantRowsInBatches(
        delegate,
        tenant.id,
      );
    }

    // The tenant row and the completion event go in one transaction: the
    // tenant is gone if and only if a tenant.purged event records it.
    // PlatformOperationEvent.tenantId is SetNull on tenant delete, so the
    // pre-existing event trail survives; the completion event carries the
    // tenant id in metadata since the FK target no longer exists.
    await this.prisma.$transaction(async (tx) => {
      await tx.platformTenant.delete({ where: { id: tenant.id } });
      await tx.platformOperationEvent.create({
        data: {
          tenantId: null,
          eventType: "tenant.purged",
          metadata: {
            tenantId: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            archivedAt: tenant.archivedAt?.toISOString() ?? null,
            purgeRequestedAt: tenant.purgeRequestedAt?.toISOString() ?? null,
            storageObjectCount: storage.deletedObjectCount,
            rowCounts,
          },
        },
      });
    });

    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      outcome: "purged",
      storageObjectCount: storage.deletedObjectCount,
      rowCounts,
    };
  }

  /**
   * Tenant-owned models in explicit deletion order, children before parents,
   * derived from the FK relations in prisma/schema.prisma. The purge never
   * relies on `onDelete` cascades between tenant-owned tables — explicit
   * batches are observable (per-table counts) and keep each statement small.
   *
   * Hard ordering constraints (`onDelete: Restrict` in the schema):
   * - `users` must go after visits, visit_notes, reports and import_jobs
   *   (representative/createdBy/confirmedBy/uploadedBy are Restrict);
   * - `locations` must go after visits, reports and route_items.
   * The rest is ordered child-first anyway so no Cascade/SetNull side
   * effects fire mid-purge (e.g. visits before route_items so routeItemId
   * SetNull never runs, storage_objects after everything that references
   * them, audit_events before users to avoid actorUserId SetNull churn).
   */
  private tenantOwnedDeletionOrder(): Array<{
    table: string;
    delegate: TenantOwnedDelegate;
  }> {
    return [
      { table: "ai_jobs", delegate: this.prisma.aiJob },
      { table: "import_row_issues", delegate: this.prisma.importRowIssue },
      { table: "import_jobs", delegate: this.prisma.importJob },
      { table: "tasks", delegate: this.prisma.task },
      { table: "visit_notes", delegate: this.prisma.visitNote },
      { table: "reports", delegate: this.prisma.report },
      { table: "visits", delegate: this.prisma.visit },
      { table: "route_items", delegate: this.prisma.routeItem },
      { table: "route_plans", delegate: this.prisma.routePlan },
      {
        table: "location_assignments",
        delegate: this.prisma.locationAssignment,
      },
      { table: "location_contacts", delegate: this.prisma.locationContact },
      { table: "locations", delegate: this.prisma.location },
      { table: "storage_objects", delegate: this.prisma.storageObject },
      { table: "invites", delegate: this.prisma.invite },
      { table: "sessions", delegate: this.prisma.session },
      { table: "user_roles", delegate: this.prisma.userRole },
      { table: "tenant_settings", delegate: this.prisma.tenantSetting },
      {
        table: "product_capabilities",
        delegate: this.prisma.productCapability,
      },
      { table: "audit_events", delegate: this.prisma.auditEvent },
      { table: "users", delegate: this.prisma.user },
    ];
  }

  private async deleteTenantRowsInBatches(
    delegate: TenantOwnedDelegate,
    tenantId: string,
  ): Promise<number> {
    let total = 0;

    for (;;) {
      const rows = await delegate.findMany({
        where: { tenantId },
        select: { id: true },
        orderBy: { id: "asc" },
        take: DELETE_BATCH_SIZE,
      });

      if (!rows.length) {
        break;
      }

      const { count } = await delegate.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      total += count;
    }

    return total;
  }

  private async resolveLastPilotActivityAt(tenant: {
    id: string;
    createdAt: Date;
  }): Promise<Date> {
    const [sessionMax, visitMax, importMax] = await Promise.all([
      this.prisma.session.aggregate({
        where: { tenantId: tenant.id },
        _max: { lastSeenAt: true, createdAt: true },
      }),
      this.prisma.visit.aggregate({
        where: { tenantId: tenant.id },
        _max: { updatedAt: true },
      }),
      this.prisma.importJob.aggregate({
        where: { tenantId: tenant.id },
        _max: { createdAt: true },
      }),
    ]);

    return maxDate(
      tenant.createdAt,
      sessionMax._max.lastSeenAt,
      sessionMax._max.createdAt,
      visitMax._max.updatedAt,
      importMax._max.createdAt,
    );
  }
}

function maxDate(first: Date, ...rest: Array<Date | null | undefined>): Date {
  let latest = first;

  for (const candidate of rest) {
    if (candidate && candidate > latest) {
      latest = candidate;
    }
  }

  return latest;
}
