import "reflect-metadata";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

import { TEXT_LIMITS } from "../../common/input-limits";

/**
 * Flat-CRUD tier of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md), scoped to ProductsController's two write
 * routes via createStrictValidationPipe().
 *
 * Optional throughout for the same reason as the rest of the tier: the
 * service keeps its own `PRODUCT_INVALID` envelope for a missing or blank
 * name, and the DTO only bounds the shape in front of it. `externalCode` is
 * declared even though the admin UI never sends it — imports write it, and a
 * whitelist that reflected only what one client happens to post would refuse
 * a documented field.
 */
export class CreateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.code)
  externalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.code)
  sku?: string;

  // A free-text category label, not the ProductCategory relation — it shares
  // the `name` cap with that vocabulary rather than having one of its own.
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  category?: string;

  // Tightening, same shape as the status fields below: normalizeBoolean folds
  // any non-boolean into `false`, so a caller sending the string "true" got
  // the opposite of what it asked for, with a 200.
  @IsOptional()
  @IsBoolean()
  notApplicable?: boolean;
}

export class UpdateProductDto extends CreateProductDto {
  @IsOptional()
  @IsIn(["active", "inactive", "archived"])
  status?: string;
}
