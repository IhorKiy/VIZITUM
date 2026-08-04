import "reflect-metadata";
import { IsOptional, IsString, MaxLength } from "class-validator";

import { TEXT_LIMITS } from "../../common/input-limits";

/**
 * Flat-CRUD tier of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md), scoped to ProductCategoriesController's
 * two write routes via createStrictValidationPipe().
 *
 * The twin of UpsertLocationCategoryDto — same single field, same reasons for
 * one class covering both routes, and the same split of responsibility: the
 * service still owns "name is required" (`PRODUCT_CATEGORY_INVALID`) and
 * per-tenant uniqueness, while the cap here reports an over-length name as
 * over-length instead of letting normalizeCategoryName fold it into the
 * missing-name error.
 */
export class UpsertProductCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  name?: string | null;
}
