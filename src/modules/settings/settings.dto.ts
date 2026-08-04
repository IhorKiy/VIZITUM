import "reflect-metadata";
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";

import { MAX_UPLOAD_FILE_NAME_LENGTH } from "../visits/visit-request-limits";
import { MAX_FIELD_REPORT_VOICE_HINT_LENGTH } from "./field-report-voice-hint";
import { MAX_TENANT_NAME_LENGTH } from "./settings.types";

/**
 * Tier 4 of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md): the administrative surfaces, where a
 * whitelist mismatch costs an admin action rather than a tenant's sessions.
 * AdminSettingsController's three bodies; the other four tier-4 controllers
 * carry their own files.
 *
 * Optional throughout, as everywhere on this track: settings.service.ts keeps
 * `SETTINGS_INVALID`, `BRANDING_LOGO_INVALID` and
 * `BRANDING_LOGO_SIZE_INVALID`, and its normalizers run unchanged behind this.
 */
export class UpdateTenantSettingsDto {
  // The cap moves earlier for the same reason it did on the route-template
  // name: normalizeName discards an over-long name and the route then answers
  // "Company name must not be empty." — true only in the sense that the value
  // was thrown away. MAX_TENANT_NAME_LENGTH is the normalizer's own number,
  // imported rather than restated.
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TENANT_NAME_LENGTH)
  name?: string | null;

  // Not narrowed to an IANA pattern: normalizeTimezone asks the runtime's own
  // time zone database (and canonicalizes "europe/kyiv" on the way through),
  // which no regex here could stand in for.
  @IsOptional()
  @IsString()
  timezone?: string | null;

  // Deliberately not @IsIn(SUPPORTED_TENANT_LANGUAGES), and colorScheme
  // likewise not @IsIn(TENANT_COLOR_SCHEMES): both service refusals enumerate
  // the allowed values in their message ("Choose one of: en, uk."), which a
  // whitelist rejection would replace with nothing. Same call as the visit
  // cancellation `reason`. Neither is a silently dropped enum — the service
  // answers 400 rather than writing a fallback — so there is nothing here for
  // the tier's enum rule to fix.
  @IsOptional()
  @IsString()
  language?: string | null;

  @IsOptional()
  @IsBoolean()
  productsEnabled?: boolean | null;

  @IsOptional()
  @IsBoolean()
  locationCategoriesEnabled?: boolean | null;

  @IsOptional()
  @IsString()
  colorScheme?: string | null;

  // `null` clears the hint, which is why this is `?: string | null` and not
  // the `@ValidateIf` idiom used on the platform bodies.
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FIELD_REPORT_VOICE_HINT_LENGTH)
  fieldReportVoiceHint?: string | null;
}

/**
 * The logo registration, twin to the visit audio/photo registrations and
 * governed by the same three decisions — see `RegisterAudioUploadDto` in
 * visits/visits.dto.ts for the long form of each:
 *
 * - `sizeBytes` is type-checked here and bounded in the service, because
 *   "Logo size must be a positive integer up to 1 MB." is what an admin with
 *   an over-large PNG needs, not "must not be greater than 1048576". It became
 *   mandatory with item 3.2 (the presigned PUT signs it as Content-Length), so
 *   the service refuses a missing one too.
 * - number-or-string, since normalizeLogoSizeBytes `Number()`s a string and
 *   narrowing to numbers alone would make the PUT unsignable for a client
 *   that sends `"1048576"`.
 * - `contentType` is not an enum: an unsupported or absent value is not an
 *   error, it falls back to the file extension.
 *
 * `MAX_UPLOAD_FILE_NAME_LENGTH` is imported from visits/visit-request-limits.ts
 * rather than redeclared: that module is constants-only (no Nest dependency)
 * and the value means "a declared upload file name", which is exactly what
 * this is. Restating 1024 in settings is the duplication this track forbids.
 */
export class RegisterLogoUploadDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_UPLOAD_FILE_NAME_LENGTH)
  fileName?: string | null;

  @IsOptional()
  @IsString()
  contentType?: string | null;

  @IsOptional()
  @ValidateIf((_dto, value) => typeof value !== "string")
  @IsNumber()
  sizeBytes?: number | string | null;
}

export class ConfirmLogoUploadDto {
  @IsOptional()
  @IsString()
  storageObjectId?: string | null;
}
