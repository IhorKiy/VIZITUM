-- Backfill completedAt for any "done" task that has none. The app has
-- always stamped completedAt when a task moves to "done", so this class of
-- row previously only existed via the cancelled -> done remap in
-- 20260721140000_tasks_priority_status_history (a cancelled task was never
-- "completed" the way an explicit done transition is). Using updatedAt as
-- the stand-in keeps the invariant "every done task has a completedAt" true
-- for old rows too, not just ones the app writes going forward.
UPDATE "tasks" SET "completedAt" = COALESCE("completedAt", "updatedAt") WHERE "status" = 'done' AND "completedAt" IS NULL;
