import "reflect-metadata";
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";

import { TEXT_LIMITS } from "../../common/input-limits";
import { DATE_ONLY_PATTERN, MONTH_PATTERN } from "./route-parsing";

/**
 * Second half of tier 3 on the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md), scoped to RouteTemplatesController's
 * eight write routes via createStrictValidationPipe() — the widest controller
 * on the track so far by route count, though each body is small.
 *
 * Optional throughout, as everywhere on this track: route-templates.service.ts
 * keeps `ROUTE_TEMPLATE_INVALID`, `ROUTE_TEMPLATE_ITEM_INVALID`,
 * `ROUTE_TEMPLATE_ITEM_REORDER_INVALID`, `ROUTE_TEMPLATE_ITEM_MOVE_INVALID`,
 * `ROUTE_TEMPLATE_ASSIGN_INVALID` and `ROUTE_COPY_MONTH_INVALID`, and runs
 * unchanged behind this.
 */
export class CreateRouteTemplateDto {
  @IsOptional()
  @IsString()
  representativeUserId?: string | null;

  // The cap moves earlier, as it did for both category vocabularies:
  // normalizeTemplateName's own comment says an over-length name is "rejected
  // the same way a blank name is", so a 200-character name came back as
  // "Representative user id and name are required." — true only in the sense
  // that the value was discarded.
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  name?: string | null;
}

/**
 * Rename carries the same single field, so it reuses the name rule rather
 * than restating it. Kept as its own class rather than one shared upsert
 * because create also takes a representative and rename must not: a template
 * cannot change hands, and inheriting the field would have made that
 * whitelisted on a route that silently ignores it.
 */
export class UpdateRouteTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  name?: string | null;
}

/**
 * One class for adding an item and for editing one: the two bodies are the
 * same two fields and always have been, and what separates the routes — the
 * item must exist, and a partial edit applies only what it names — lives in
 * the service, not in the shape.
 */
export class UpsertRouteTemplateItemDto {
  @IsOptional()
  @IsString()
  locationId?: string | null;

  // Same tightening as the route-item twin: on the PATCH a non-integer
  // sequence was normalized to null and then spread away, so `{"sequence":
  // "3"}` renumbered nothing under a 200.
  @IsOptional()
  @IsInt()
  @Min(1)
  sequence?: number | null;
}

/** The twin of `ReorderRouteItemsDto`, for the template's own item list. */
export class ReorderRouteTemplateItemsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[] | null;
}

export class MoveRouteTemplateItemDto {
  // Optional so `ROUTE_TEMPLATE_ITEM_MOVE_INVALID` stays the service's answer
  // for a missing direction — it names the two allowed values, which a
  // whitelist rejection would not. Anything else present is refused here.
  @IsOptional()
  @IsIn(["up", "down"])
  direction?: string | null;
}

export class AssignRouteTemplateDto {
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, {
    message: "planDate must be in YYYY-MM-DD format.",
  })
  planDate?: string | null;
}

export class CopyRoutePlansDto {
  // Shape only, like the date fields: normalizeMonth still refuses a month
  // number outside 1-12, which the pattern admits ("2026-13"). MONTH_PATTERN
  // is imported from route-parsing.ts, where normalizeMonth now reads it too.
  @IsOptional()
  @Matches(MONTH_PATTERN, { message: "month must be in YYYY-MM format." })
  month?: string | null;
}

export class CopyRouteWeekDto {
  // Shape only again — that each value is a real Monday is a calendar
  // question the pattern can't ask, so the service re-checks it.
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, {
    message: "fromWeekStart must be in YYYY-MM-DD format.",
  })
  fromWeekStart?: string | null;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, {
    message: "toWeekStart must be in YYYY-MM-DD format.",
  })
  toWeekStart?: string | null;
}
