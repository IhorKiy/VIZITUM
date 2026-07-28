-- Manager-authored notices shown to every field representative for the
-- length of an inclusive, date-only validity window, plus the per-user
-- read receipts that record who has seen each one. Both tables are
-- tenant-scoped like every other business table; the receipt's unique
-- constraint is what makes marking read idempotent.

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "createdByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_read_receipts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_read_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_tenantId_archivedAt_endsAt_idx" ON "announcements"("tenantId", "archivedAt", "endsAt");

-- CreateIndex
CREATE INDEX "announcements_tenantId_createdAt_idx" ON "announcements"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "announcement_read_receipts_tenantId_userId_idx" ON "announcement_read_receipts"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_read_receipts_tenantId_announcementId_userId_key" ON "announcement_read_receipts"("tenantId", "announcementId", "userId");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_read_receipts" ADD CONSTRAINT "announcement_read_receipts_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_read_receipts" ADD CONSTRAINT "announcement_read_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

