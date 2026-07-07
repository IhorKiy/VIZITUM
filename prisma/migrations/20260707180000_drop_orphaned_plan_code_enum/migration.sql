-- `unify_tenant_status_and_plan` dropped the `platform_tenants.planCode`
-- column but Postgres does not drop a column's enum type along with it,
-- leaving `PlanCode` orphaned (unused by any table). Clean it up here so it
-- doesn't linger indefinitely.
DROP TYPE "PlanCode";
