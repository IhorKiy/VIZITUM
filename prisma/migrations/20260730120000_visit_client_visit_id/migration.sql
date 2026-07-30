-- Identifier the device mints when a rep starts a visit with no signal.
--
-- Two jobs. It is the idempotency key for the deferred create — a phone cannot
-- tell a request that was lost from one whose answer was — and it is how a
-- locally-started visit keeps a stable URL, since the visit screen can resolve
-- either this or the server's own id.
--
-- Deliberately not the primary key: the server keeps minting its own cuid, so
-- row identity never moves into client hands.
--
-- Nullable, so the uniqueness below is partial in effect — Postgres admits
-- unlimited NULLs in a unique index, which is what lets every visit started
-- before this existed, and every online start that sends nothing, coexist
-- untouched. No backfill.
ALTER TABLE "visits" ADD COLUMN "clientVisitId" TEXT;

-- Tenant-scoped rather than global, matching the isolation invariant the rest of
-- the schema holds: one tenant's client id can never collide with or address
-- another's visit.
CREATE UNIQUE INDEX "visits_tenantId_clientVisitId_key" ON "visits"("tenantId", "clientVisitId");
