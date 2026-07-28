-- The "done" task list reads through a completion window and orders by
-- completedAt desc, in two scopes: a representative's own finished work
-- (assignedToUserId is pinned by the request context) and a manager's
-- tenant-wide view (no assignee filter, so the shorter index is the one the
-- planner can use).
--
-- completedAt trails the equality columns in both, so the window's range scan
-- and the ordering come off the same index instead of a filter-then-sort over
-- everything the tenant ever closed.

-- CreateIndex
CREATE INDEX "tasks_tenantId_assignedToUserId_status_completedAt_idx" ON "tasks"("tenantId", "assignedToUserId", "status", "completedAt");

-- CreateIndex
CREATE INDEX "tasks_tenantId_status_completedAt_idx" ON "tasks"("tenantId", "status", "completedAt");
