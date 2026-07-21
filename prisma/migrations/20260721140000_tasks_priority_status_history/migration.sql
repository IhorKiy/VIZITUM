-- Simplify Task priority/status and add a per-task status history table.
--
-- Order matters: data must be remapped onto values that survive BEFORE the
-- enum is narrowed, since Postgres has no ALTER TYPE ... DROP VALUE and a
-- column can never hold a value outside its enum's current value set.
--
-- Priority: replace the 3-value enum with a boolean flag: high -> true
-- (isPriority), low/normal -> false (regular).
-- Status: narrow to in_progress/done: open -> in_progress (new tasks now
-- start here), cancelled -> done (must not resurface as active work).

-- AddColumn
ALTER TABLE "tasks" ADD COLUMN "isPriority" BOOLEAN NOT NULL DEFAULT false;

-- Backfill isPriority from the old priority column before dropping it.
UPDATE "tasks" SET "isPriority" = true WHERE "priority" = 'high';

-- Remap status onto the two values that will survive the enum narrowing
-- below, while the old enum values are still valid.
UPDATE "tasks" SET "status" = 'in_progress' WHERE "status" = 'open';
UPDATE "tasks" SET "status" = 'done' WHERE "status" = 'cancelled';

-- DropColumn
ALTER TABLE "tasks" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "tasks" DROP COLUMN "priority";
DROP TYPE "TaskPriority";

-- Narrow TaskStatus to in_progress/done. Swap in a new type: create it,
-- repoint the column through text (already-remapped values re-parse
-- cleanly), then drop the old type and rename the new one into its place.
CREATE TYPE "TaskStatus_new" AS ENUM ('in_progress', 'done');
ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tasks" ALTER COLUMN "status" TYPE "TaskStatus_new" USING ("status"::text::"TaskStatus_new");
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'in_progress';
DROP TYPE "TaskStatus";
ALTER TYPE "TaskStatus_new" RENAME TO "TaskStatus";

-- CreateTable
CREATE TABLE "task_status_history" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "oldStatus" "TaskStatus",
    "newStatus" "TaskStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_status_history_tenantId_taskId_createdAt_idx" ON "task_status_history"("tenantId", "taskId", "createdAt");

-- CreateIndex
CREATE INDEX "task_status_history_tenantId_changedByUserId_createdAt_idx" ON "task_status_history"("tenantId", "changedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
