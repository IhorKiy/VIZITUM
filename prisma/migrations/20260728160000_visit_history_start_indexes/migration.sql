-- Indexes for the history-boundary query on GET /visits/day-summary.
--
-- `historyStart` asks MIN(COALESCE("startedAt","createdAt")) over the request's
-- scope with no period bound (visits.service.ts). Without a status filter that
-- is already a one-row index scan on the expression indexes added in
-- 20260728120000. *With* one it was not: the planner kept the same index and
-- filtered by status while walking, so the scan ran until it met the first
-- matching row — or to the end of the scope when there was none. Measured on
-- 300k rows: a representative with 15000 visits and none of the selected
-- status cost 15023 shared buffers, and a tenant-wide query for a status that
-- only exists in recent rows cost 298680 — very nearly the whole table.
--
-- Composite rather than one partial index per status. They read the same (3-4
-- shared buffers either way in every case measured), so the tie broke on the
-- schema: two objects instead of eight, and no new index the day a fifth
-- VisitStatus appears. The price, measured and accepted: partial indexes were
-- ~8% cheaper on a 20k-row bulk insert (810ms vs 880ms) and ~10% smaller
-- (66MB vs 73MB of visit indexes) — note that the intuition "eight partial
-- indexes means eight writes per row" is wrong, since a row matches exactly
-- one partial index per scope, which is why the two are so close.
--
-- These do NOT replace the expression indexes from 20260728120000: `status`
-- sits between the scope columns and the timestamp expression, so a query with
-- no status filter gets no sorted range out of these. Verified by dropping
-- them on the same dataset — the tenant-wide day-summary GROUP BY fell to a
-- parallel sequential scan (405 -> 3910 buffers) and the unfiltered
-- history boundary to a bitmap scan (4 -> 223). Both families stay.
--
-- Hand-written for the same reason as 20260728120000: Prisma's schema language
-- cannot express an index on an expression.
--
-- Known gap, left alone deliberately: a *multi*-status filter
-- (`status=completed,cancelled`) still falls back to the old path, because a
-- MIN over `status = ANY(...)` cannot be answered by one boundary scan. Both
-- index shapes behave identically there, so it buys nothing. Every screen in
-- the product sends at most one status.
CREATE INDEX "visits_tenant_representative_status_period_idx"
ON "visits" ("tenantId", "representativeUserId", "status", (COALESCE("startedAt", "createdAt")));

CREATE INDEX "visits_tenant_status_period_idx"
ON "visits" ("tenantId", "status", (COALESCE("startedAt", "createdAt")));
