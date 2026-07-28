-- The (tenantId, announcementId, userId) unique index leads with tenantId, so
-- it cannot serve a lookup keyed on the announcement alone. Both the manager
-- board's per-row read count and the announcement's ON DELETE CASCADE do
-- exactly that, so give them an index that starts where they start.

-- CreateIndex
CREATE INDEX "announcement_read_receipts_announcementId_idx" ON "announcement_read_receipts"("announcementId");
