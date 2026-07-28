-- Indexes for the *list* half of the period filter.
--
-- The migration before this one added expression indexes on
-- COALESCE("startedAt", "createdAt"), which serve the day-summary aggregate —
-- that query sends the COALESCE literally. The list does not: buildVisitWhere
-- goes through the ORM, and Prisma expands the same intent into
--
--   "startedAt" >= $1 OR ("startedAt" IS NULL AND "createdAt" >= $2)
--
-- which no expression index can match. Measured on a 300k-row table, the
-- tenant-wide list (manager visits) was a sequential scan for all three of its
-- queries — findMany, count and the status groupBy — because no index started
-- with ("tenantId", <a time column>) at all; the representative-scoped list
-- (field history) had only the first branch of that OR covered.
--
-- One index per branch, in both scopes, so the planner can bitmap-OR them. The
-- createdAt pairs also match the list's ORDER BY "createdAt" DESC.
--
-- Written by `prisma migrate dev --create-only` from the @@index entries on the
-- Visit model — unlike the expression indexes, these are plain enough for
-- Prisma to own. Renamed to sort after that migration; the two are independent,
-- so either order applies cleanly.

-- CreateIndex
CREATE INDEX "visits_tenantId_representativeUserId_createdAt_idx" ON "visits"("tenantId", "representativeUserId", "createdAt");

-- CreateIndex
CREATE INDEX "visits_tenantId_startedAt_idx" ON "visits"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "visits_tenantId_createdAt_idx" ON "visits"("tenantId", "createdAt");
