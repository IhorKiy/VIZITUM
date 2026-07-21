-- Replace the plain unique index on (tenantId, representativeUserId, planDate)
-- with two PARTIAL unique indexes so a representative can hold several
-- template-based route plans on the same day (one per distinct template)
-- instead of exactly one route plan per day. A manager assigning a second
-- route template to an already-planned day previously hit a 409
-- ROUTE_PLAN_ALREADY_EXISTS even though the two templates cover different
-- stops; the field planning calendar needs to support several named routes
-- per day (see the "Сьогодні" section of the planning tab).
--
-- - route_plans_rep_date_template_key still blocks assigning the *same*
--   template twice on the same day.
-- - route_plans_rep_date_no_template_key preserves the previous "at most one
--   plan per day" behavior for template-less manual plans created via
--   RoutesService.createRoutePlan (routeTemplateId IS NULL), which relied on
--   the old constraint for its get-or-create upsert.
DROP INDEX "route_plans_tenantId_representativeUserId_planDate_key";

CREATE UNIQUE INDEX "route_plans_rep_date_template_key"
  ON "route_plans" ("tenantId", "representativeUserId", "planDate", "routeTemplateId")
  WHERE "routeTemplateId" IS NOT NULL;

CREATE UNIQUE INDEX "route_plans_rep_date_no_template_key"
  ON "route_plans" ("tenantId", "representativeUserId", "planDate")
  WHERE "routeTemplateId" IS NULL;
