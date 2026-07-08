import type { PrismaService } from "../../src/modules/prisma/prisma.service";
import type { StorageService } from "../../src/modules/storage/storage.service";
import { TenantPurgeService } from "../../src/modules/platform/tenant-purge.service";

/**
 * In-memory stand-in for the narrow slice of Prisma the purge worker uses:
 * platform tenants with the where semantics of the eligibility/claim
 * queries, tenant-owned tables as flat id+tenantId rows, operation events,
 * and per-tenant activity aggregates for the pilot auto-archive pass.
 * `deletionLog` records every destructive step in order ("storage:<tenant>"
 * then "<table>:<tenant>:<count>" then "tenant:<tenant>") so tests can pin
 * the storage-before-rows and child-before-parent ordering.
 */

export type FakeTenant = {
  id: string;
  slug: string;
  name: string;
  status: string;
  archivedAt: Date | null;
  purgeRequestedAt: Date | null;
  purgeStartedAt: Date | null;
  createdAt: Date;
};

export type TenantActivity = {
  sessionLastSeenAt?: Date;
  sessionCreatedAt?: Date;
  visitUpdatedAt?: Date;
  importCreatedAt?: Date;
};

export const TENANT_OWNED_TABLES = [
  "ai_jobs",
  "import_row_issues",
  "import_jobs",
  "tasks",
  "visit_notes",
  "reports",
  "visits",
  "route_items",
  "route_plans",
  "location_assignments",
  "location_contacts",
  "locations",
  "storage_objects",
  "invites",
  "sessions",
  "user_roles",
  "tenant_settings",
  "product_capabilities",
  "audit_events",
  "users",
] as const;

const DELEGATE_BY_TABLE: Record<string, string> = {
  ai_jobs: "aiJob",
  import_row_issues: "importRowIssue",
  import_jobs: "importJob",
  tasks: "task",
  visit_notes: "visitNote",
  reports: "report",
  visits: "visit",
  route_items: "routeItem",
  route_plans: "routePlan",
  location_assignments: "locationAssignment",
  location_contacts: "locationContact",
  locations: "location",
  storage_objects: "storageObject",
  invites: "invite",
  sessions: "session",
  user_roles: "userRole",
  tenant_settings: "tenantSetting",
  product_capabilities: "productCapability",
  audit_events: "auditEvent",
  users: "user",
};

type TenantListWhere = {
  status?: string;
  createdAt?: { lte: Date };
  OR?: Array<{
    purgeStartedAt?: { not: null };
    purgeRequestedAt?: { not: null };
    archivedAt?: { not: null; lte: Date };
  }>;
};

type TenantUpdateWhere = {
  id: string;
  status?: string;
  purgeStartedAt?: null;
};

export function createPurgeStore(
  seedTenants: Array<Partial<FakeTenant> & { id: string }>,
) {
  const tenants: FakeTenant[] = seedTenants.map((seed) => ({
    slug: seed.id,
    name: seed.id,
    status: "archived",
    archivedAt: null,
    purgeRequestedAt: null,
    purgeStartedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...seed,
  }));
  const rowsByTable = new Map<string, Array<{ id: string; tenantId: string }>>(
    TENANT_OWNED_TABLES.map((table) => [table, []]),
  );
  const events: Array<Record<string, unknown>> = [];
  const deletionLog: string[] = [];
  const activityByTenantId = new Map<string, TenantActivity>();
  // Invoked before every platformTenant.updateMany, simulating a concurrent
  // writer that changes rows between the eligibility read and the
  // conditional claim/archive write.
  const raceState: { beforeUpdateMany?: () => void } = {};

  const seedRows = (table: string, tenantId: string, count: number) => {
    const rows = rowsByTable.get(table);

    if (!rows) {
      throw new Error(`Unknown tenant-owned table: ${table}`);
    }

    for (let index = 0; index < count; index += 1) {
      rows.push({ id: `${table}-${tenantId}-${index}`, tenantId });
    }
  };

  const matchesListWhere = (tenant: FakeTenant, where: TenantListWhere) => {
    if (where.status !== undefined && tenant.status !== where.status) {
      return false;
    }

    if (where.createdAt?.lte && tenant.createdAt > where.createdAt.lte) {
      return false;
    }

    if (where.OR) {
      return where.OR.some((condition) => {
        if (condition.purgeStartedAt?.not === null) {
          return tenant.purgeStartedAt !== null;
        }

        if (condition.purgeRequestedAt?.not === null) {
          return tenant.purgeRequestedAt !== null;
        }

        if (condition.archivedAt) {
          return (
            tenant.archivedAt !== null &&
            tenant.archivedAt <= condition.archivedAt.lte
          );
        }

        return false;
      });
    }

    return true;
  };

  const tenantDelegate = {
    findMany: async ({ where }: { where: TenantListWhere }) =>
      tenants
        .filter((tenant) => matchesListWhere(tenant, where))
        .map((tenant) => ({ ...tenant })),
    updateMany: async ({
      where,
      data,
    }: {
      where: TenantUpdateWhere;
      data: Partial<FakeTenant>;
    }) => {
      raceState.beforeUpdateMany?.();
      raceState.beforeUpdateMany = undefined;

      const tenant = tenants.find((candidate) => candidate.id === where.id);

      if (
        !tenant ||
        (where.status !== undefined && tenant.status !== where.status) ||
        (where.purgeStartedAt === null && tenant.purgeStartedAt !== null)
      ) {
        return { count: 0 };
      }

      Object.assign(tenant, data);
      return { count: 1 };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = tenants.findIndex((tenant) => tenant.id === where.id);

      if (index === -1) {
        throw new Error(`Tenant not found: ${where.id}`);
      }

      const [removed] = tenants.splice(index, 1);
      deletionLog.push(`tenant:${where.id}`);
      return removed;
    },
  };

  const makeAggregate =
    (pick: (activity: TenantActivity) => Record<string, Date | null>) =>
    async ({ where }: { where: { tenantId: string } }) => ({
      _max: pick(activityByTenantId.get(where.tenantId) ?? {}),
    });

  const client: Record<string, unknown> = {
    platformTenant: tenantDelegate,
    platformOperationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      },
    },
  };

  for (const table of TENANT_OWNED_TABLES) {
    const delegate = {
      findMany: async ({
        where,
        take,
      }: {
        where: { tenantId: string };
        take: number;
      }) =>
        rowsByTable
          .get(table)!
          .filter((row) => row.tenantId === where.tenantId)
          .slice(0, take)
          .map((row) => ({ id: row.id })),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        const ids = new Set(where.id.in);
        const rows = rowsByTable.get(table)!;
        const removed = rows.filter((row) => ids.has(row.id));
        rowsByTable.set(
          table,
          rows.filter((row) => !ids.has(row.id)),
        );

        if (removed.length > 0) {
          deletionLog.push(`${table}:${removed[0].tenantId}:${removed.length}`);
        }

        return { count: removed.length };
      },
    };

    client[DELEGATE_BY_TABLE[table]] = delegate;
  }

  // Auto-archive activity aggregates. The purge path never calls these.
  Object.assign(client.session as object, {
    aggregate: makeAggregate((activity) => ({
      lastSeenAt: activity.sessionLastSeenAt ?? null,
      createdAt: activity.sessionCreatedAt ?? null,
    })),
  });
  Object.assign(client.visit as object, {
    aggregate: makeAggregate((activity) => ({
      updatedAt: activity.visitUpdatedAt ?? null,
    })),
  });
  Object.assign(client.importJob as object, {
    aggregate: makeAggregate((activity) => ({
      createdAt: activity.importCreatedAt ?? null,
    })),
  });

  const prisma = {
    ...client,
    $transaction: async (callback: (tx: typeof client) => Promise<unknown>) =>
      callback(client),
  };

  return {
    prisma,
    tenants,
    rowsByTable,
    events,
    deletionLog,
    activityByTenantId,
    raceState,
    seedRows,
    remainingRowCount(tenantId: string): number {
      let total = 0;

      for (const rows of rowsByTable.values()) {
        total += rows.filter((row) => row.tenantId === tenantId).length;
      }

      return total;
    },
  };
}

export type PurgeStore = ReturnType<typeof createPurgeStore>;

export type FakeStorageResult = {
  scannedObjectCount: number;
  deletedObjectCount: number;
  failedObjectCount: number;
};

export function createTenantPurgeService(
  store: PurgeStore,
  options: {
    storageResults?: Record<string, FakeStorageResult>;
  } = {},
) {
  const storageCalls: string[] = [];
  const storageService = {
    deleteAllTenantObjects: async (tenantId: string) => {
      storageCalls.push(tenantId);
      store.deletionLog.push(`storage:${tenantId}`);

      return (
        options.storageResults?.[tenantId] ?? {
          scannedObjectCount: 0,
          deletedObjectCount: 0,
          failedObjectCount: 0,
        }
      );
    },
  };

  const service = new TenantPurgeService(
    store.prisma as unknown as PrismaService,
    storageService as unknown as StorageService,
  );

  return { service, storageCalls };
}
