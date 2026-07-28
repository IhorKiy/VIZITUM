-- Indexes for the expression every visit query actually filters on.
--
-- A visit is placed in time by COALESCE("startedAt", "createdAt"): a
-- never-started visit has no startedAt, so both the list WHERE and the
-- day-summary GROUP BY fall back to createdAt (see buildVisitWhere and
-- getVisitDaySummary in src/modules/visits/visits.service.ts). The plain
-- ("tenantId", "representativeUserId", "startedAt") index cannot serve that
-- expression, so those queries were sequential scans over a tenant's whole
-- visit table.
--
-- Prisma's schema language has no syntax for expression indexes, so these live
-- here rather than in prisma/schema.prisma (which carries a pointer comment on
-- the Visit model). `prisma migrate diff` will not try to drop them: it only
-- reconciles what the schema can express.
--
-- Two shapes, because the two screens filter differently: the field history
-- list is always scoped to one representative, while the manager visit list is
-- team-wide and only sometimes names one.
CREATE INDEX "visits_tenant_representative_period_idx"
ON "visits" ("tenantId", "representativeUserId", (COALESCE("startedAt", "createdAt")));

CREATE INDEX "visits_tenant_period_idx"
ON "visits" ("tenantId", (COALESCE("startedAt", "createdAt")));
