-- Client-minted ids that resolve to a visit they did not create.
--
-- "visits"."clientVisitId" already covers the ordinary deferred start, where the
-- id the phone minted becomes the id of the row the server creates. It cannot
-- cover the adopt outcome: a route stop has exactly one visit slot, so a start
-- arriving to find the rep's own visit already open there is handed that visit
-- instead — and two devices, or two retries whose responses were both lost, can
-- arrive at the same open visit carrying two different minted ids. One column
-- takes only the first; the second then has nothing to replay onto, re-derives
-- the slot from scratch on its next retry, and — if the adopted visit has closed
-- by then — creates a second, unwanted, unlinked visit for a stop already done.
--
-- No backfill. Visits adopted before this existed carry their first adopter's id
-- in "visits"."clientVisitId", which the lookup still tries first, so nothing
-- that resolves today stops resolving.
CREATE TABLE "visit_client_aliases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "clientVisitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_client_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_client_aliases_visitId_idx" ON "visit_client_aliases"("visitId");

-- Tenant-scoped rather than global, matching "visits"."clientVisitId" and the
-- isolation invariant the rest of the schema holds: one tenant's client id can
-- never collide with or address another's visit. Uniqueness is also what makes
-- recording an alias idempotent — a concurrent retry inserting the same id is
-- skipped rather than duplicating the mapping.
CREATE UNIQUE INDEX "visit_client_aliases_tenantId_clientVisitId_key" ON "visit_client_aliases"("tenantId", "clientVisitId");

-- AddForeignKey
ALTER TABLE "visit_client_aliases" ADD CONSTRAINT "visit_client_aliases_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
