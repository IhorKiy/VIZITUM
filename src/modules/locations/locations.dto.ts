import "reflect-metadata";
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";

import { TEXT_LIMITS } from "../../common/input-limits";

/**
 * The last module of the flat-CRUD tier on the class-validator DTO track (2.4
 * in docs/security-remediation-plan.md), held back from #217 for its own
 * change: six write routes across three resources — the location, its
 * contacts and its assignments — against the two-per-controller the rest of
 * the tier had, and the module both category vocabularies and chains hang off.
 *
 * Optional throughout, as everywhere on this track. `parseCreateLocationBody`
 * and its siblings keep ownership of required-ness (`LOCATION_INVALID`,
 * `LOCATION_CONTACT_INVALID`, `LOCATION_ASSIGNMENT_INVALID`), of trimming, of
 * phone and email validity, and of the tenant-scoped reference checks; all of
 * that runs unchanged behind this. Caps come from TEXT_LIMITS rather than
 * being restated, so this layer cannot drift from the assertTextWithinLimit
 * calls behind it.
 */
export class CreateLocationDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.addressLine)
  addressLine?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.city)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.code)
  externalCode?: string | null;

  // The two dictionary links, and the sharpest tightening in this module.
  // normalizeId folds a non-string into null, which on PATCH does not mean
  // "leave it alone" — the field is present, so null is written: `{"chainId":
  // 0}` unlinked the location's chain and answered 200. `@IsString()` refuses
  // that; an explicit `null` still clears the link, which is the documented
  // way to do it.
  //
  // Neither carries a length cap, matching the id fields in tasks.dto.ts:
  // there is no cap on an id anywhere today, and the value is looked up
  // against the tenant's own rows immediately after, which is the check that
  // actually matters.
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  chainId?: string | null;

  // A number or a numeric string. normalizeCoordinate accepts both — it
  // parseFloat()s a string and answers `LOCATION_COORDINATE_INVALID` for
  // anything unparseable — so the loose half of that contract is deliberate
  // and, unlike the id fields above, never a silent wrong write. @ValidateIf
  // therefore steps aside for strings and leaves them to the service, while
  // @IsNumber() still refuses an object or an array here rather than one
  // layer later. Narrowing this to numbers alone would be a contract change
  // no finding asked for; the CSV import writes coordinates through the
  // service, not through this route, so nothing here would have noticed.
  @IsOptional()
  @ValidateIf((_dto, value) => typeof value !== "string")
  @IsNumber()
  latitude?: number | string | null;

  @IsOptional()
  @ValidateIf((_dto, value) => typeof value !== "string")
  @IsNumber()
  longitude?: number | string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.notes)
  notes?: string | null;
}

export class UpdateLocationDto extends CreateLocationDto {
  // Same tightening as chains and products, with one difference worth naming:
  // `archived` is not merely unrecognised here, it is a status this endpoint
  // deliberately does not write (archiving is `DELETE /locations/:id`). Both
  // it and a typo used to be mapped to null and spread away — the caller was
  // told 200 and the status did not move. It is now a 400.
  @IsOptional()
  @IsIn(["active", "inactive"])
  status?: string | null;
}

/**
 * `PATCH /locations/:locationId/notes` — the one route in this module whose
 * normalizer was already strict about type: normalizeNotesInput rejects a
 * non-string outright rather than reading it as "clear the note". The DTO
 * reaches the same verdict a step earlier, so a non-string now answers
 * `VALIDATION_FAILED` instead of `LOCATION_NOTES_INVALID`. What a caller may
 * send is unchanged, including the three ways to clear a note (omitted, null,
 * blank).
 */
export class UpdateLocationNotesDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.notes)
  notes?: string | null;
}

/**
 * One class for create and update, as with the category vocabularies: the two
 * bodies are the same five fields and always have been, and what separates
 * the routes — the contact must exist, and an unchanged phone or email is
 * passed through unvalidated so a legacy value doesn't block an unrelated
 * edit — lives in parseUpdateContactBody, not in the shape.
 */
export class UpsertLocationContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.title)
  roleTitle?: string | null;

  // The one field in this module with no cap, deliberately. Nothing behind it
  // caps a phone either: normalizePhoneInput hands the value to
  // libphonenumber, which bounds a valid number far below any character
  // limit. Declaring TEXT_LIMITS.phone here would therefore be a new limit
  // rather than a mirror of an existing one — and the only value it could
  // reject is an unchanged legacy phone that predates normalization, which is
  // exactly what the update path goes out of its way to keep editable.
  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.email)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.notes)
  notes?: string | null;
}

export class CreateLocationAssignmentDto {
  // Optional for the reason the whole tier is: "representative user id is
  // required" stays the service's `LOCATION_ASSIGNMENT_INVALID`, with the
  // field error the admin console already renders. @IsString() adds only the
  // case that answer got wrong — a non-string id read as "missing".
  @IsOptional()
  @IsString()
  representativeUserId?: string | null;
}
