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
import { DATE_ONLY_PATTERN } from "./route-parsing";

/**
 * First half of tier 3 on the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md), scoped to RoutesController's five write
 * routes via createStrictValidationPipe(). `route-templates.dto.ts` is the
 * other half; `visits` is the third and goes on its own.
 *
 * The tier was scheduled as "the first to need `@ValidateNested`/`@Type`,
 * since route items arrive as arrays". They do arrive as arrays — but of
 * **ids**, not of objects: a route item is created one request at a time, and
 * the only array on either controller is `itemIds` on reorder. So this tier
 * needs `@IsString({ each: true })` and no nesting at all. The prediction was
 * wrong in a useful direction, and `visits` is where the plan's concern about
 * opaque bodies actually lands.
 *
 * Optional throughout, as everywhere on this track: routes.service.ts keeps
 * `ROUTE_PLAN_INVALID`, `ROUTE_ITEM_INVALID` and
 * `ROUTE_ITEM_REORDER_INVALID`, along with the tenant-scoped location lookup
 * and the permutation check, and runs unchanged behind this.
 */
export class CreateRoutePlanDto {
  @IsOptional()
  @IsString()
  representativeUserId?: string | null;

  // Shape only. parseDateOnly still rejects a calendar-invalid day that fits
  // the pattern ("2026-02-31"), which a regex cannot see; DATE_ONLY_PATTERN
  // is imported from the module it guards rather than restated.
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, {
    message: "planDate must be in YYYY-MM-DD format.",
  })
  planDate?: string | null;
}

export class UpdateRoutePlanDto {
  // Tightening, the tier's familiar one: normalizeRouteStatus maps anything
  // outside these five to null, which the update then spreads away — a typo'd
  // status was accepted with a 200 and changed nothing.
  @IsOptional()
  @IsIn(["draft", "published", "in_progress", "completed", "cancelled"])
  status?: string | null;

  // Deliberately only a string, for the same reason as tasks.dto.ts's
  // `completedAt`: parseOptionalDateTime accepts anything `new Date()` can
  // read and answers `DATETIME_INVALID` for the rest, so pinning an ISO shape
  // here would narrow a contract the service defines more loosely. `""` and
  // `null` both have to survive the gate — they are how a caller clears the
  // publication timestamp.
  @IsOptional()
  @IsString()
  publishedAt?: string | null;
}

export class CreateRouteItemDto {
  @IsOptional()
  @IsString()
  locationId?: string | null;

  // Tightening on the PATCH twin below rather than here: normalizePositiveInteger
  // returns null for a non-integer, and `...(sequence ? { sequence } : {})`
  // then drops it, so `{"sequence": "3"}` reordered nothing under a 200. On
  // create the same null is caught as "sequence is required".
  @IsOptional()
  @IsInt()
  @Min(1)
  sequence?: number | null;

  @IsOptional()
  @IsString()
  plannedStartTime?: string | null;

  @IsOptional()
  @IsString()
  plannedEndTime?: string | null;
}

export class UpdateRouteItemDto extends CreateRouteItemDto {
  @IsOptional()
  @IsIn(["planned", "visited", "skipped"])
  status?: string | null;

  // The cap normalizeOptionalString applies to this field is TEXT_LIMITS.title
  // (200), not `notes` — it is a one-line reason, and the two layers agree
  // because both read the same key. A non-string used to mean "clear the skip
  // reason" here, since the field is present on a PATCH: the same wrong-type
  // shape `locations` surfaced.
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.title)
  skipReason?: string | null;
}

export class ReorderRouteItemsDto {
  // The whole permutation rule — every current item exactly once — stays in
  // normalizeIdList plus the service's own comparison against the plan's
  // items, which is the only place that knows what those are. This bounds the
  // shape: a list, of strings.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[] | null;
}
