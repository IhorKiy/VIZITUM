import "reflect-metadata";
import { IsOptional, IsString, MaxLength } from "class-validator";

import { TEXT_LIMITS } from "../../common/input-limits";

/**
 * Flat-CRUD tier of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md), scoped to
 * LocationCategoriesController's two write routes via
 * createStrictValidationPipe().
 *
 * One class for create and update, because the two bodies are the same single
 * field and always have been — splitting them would be two names for one
 * shape, and the update route's own semantics (the category must exist) are
 * carried by the path parameter, not the body.
 *
 * `name` stays optional here so the service keeps ownership of the
 * "name is required" response (`LOCATION_CATEGORY_INVALID`) and of the
 * per-tenant uniqueness rule it enforces right after.
 *
 * The cap is worth having at this layer rather than only behind it:
 * normalizeCategoryName folds an over-length name into the same null as a
 * missing one, so today a 200-character name comes back as "Name is
 * required." — true only in the sense that the value was discarded. MaxLength
 * names the actual problem before the service ever sees it.
 */
export class UpsertLocationCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  name?: string | null;
}
