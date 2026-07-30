-- Idempotency token for report confirmation, minted by the device.
--
-- A rep who confirms a report in a dead zone cannot hear whether the request
-- landed. Without a token, the queued retry has to either risk doing the work
-- twice or risk never sending at all; with one, the server recognises the replay
-- and returns the report the first attempt produced.
--
-- Nullable, and the uniqueness is therefore partial in effect: Postgres admits
-- unlimited NULLs in a unique index, so every report confirmed before this
-- existed — and every confirm that does not send a token — coexists untouched.
-- No backfill is needed or wanted.
ALTER TABLE "reports" ADD COLUMN "clientRequestId" TEXT;

-- Scoped to the tenant rather than global: the token is opaque client input, and
-- tenant isolation is the invariant this codebase holds everywhere, so one
-- tenant's token can never collide with or address another's report.
CREATE UNIQUE INDEX "reports_tenantId_clientRequestId_key" ON "reports"("tenantId", "clientRequestId");
