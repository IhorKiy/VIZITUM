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
import {
  MAX_CLIENT_REQUEST_ID_LENGTH,
  MAX_UPLOAD_FILE_NAME_LENGTH,
  MAX_VISIT_CANCELLATION_COMMENT_LENGTH,
} from "./visit-request-limits";

/**
 * First of the two PRs the design note
 * (docs/plans/visits-dto-migration-note.md) splits `visits` into: the six
 * bodies `VisitsService` owns. The five `AiService` bodies — including both
 * `confirmedData` envelopes and the one genuinely nested `products[]` — follow
 * in their own change, because the question they raise is replay
 * compatibility rather than validators.
 *
 * `visits` is the last module of tier 3 and the field app's entire reporting
 * path runs through it, so the note's rule applies throughout and more
 * strictly than elsewhere: the DTO declares what a body may *contain*, and
 * every judgement a caller could reasonably get wrong stays with the service,
 * whose messages say what to do about it. Where those two pull in opposite
 * directions, the comments below say which won and why.
 */
export class CreateVisitDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  // Optional in every sense: omitted, it means "me" (createVisit falls back to
  // context.userId), which is what the field app relies on.
  @IsOptional()
  @IsString()
  representativeUserId?: string;

  // normalizeOptionalId reads "" as "no route item", so the empty string has
  // to survive the gate; @IsString() admits it.
  @IsOptional()
  @IsString()
  routeItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.code)
  visitType?: string;

  // parseOptionalDateTime owns what a timestamp may be here, as it does on
  // routes.dto.ts's publishedAt: it accepts anything `new Date()` can read and
  // answers DATETIME_INVALID for the rest, and a deferred start is separately
  // bounded server-side against a request that lands long after it was made.
  // An ISO pattern here would narrow that and buy nothing.
  @IsOptional()
  @IsString()
  startedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CLIENT_REQUEST_ID_LENGTH)
  clientVisitId?: string;
}

export class UpdateVisitDto {
  // `cancelled` is in this list deliberately, though the route refuses it.
  // normalizeVisitStatus recognises the other three and drops anything else
  // (the tier's usual silent no-op, worth refusing) — but `cancelled` is
  // checked *before* that and answers "Use POST /visits/:visitId/cancel to
  // cancel a visit." Excluding it here would replace that instruction with a
  // bare VALIDATION_FAILED, which tells the caller less than the API already
  // did. See Q5 in the design note.
  @IsOptional()
  @IsIn(["draft", "in_progress", "completed", "cancelled"])
  status?: string;

  @IsOptional()
  @IsString()
  startedAt?: string;

  @IsOptional()
  @IsString()
  completedAt?: string;
}

export class CancelVisitDto {
  // Deliberately not @IsIn(VISIT_CANCELLATION_REASONS): the service's
  // CANCELLATION_REASON_INVALID names every allowed reason in its message,
  // which a whitelist rejection would not. The other half of Q5.
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_VISIT_CANCELLATION_COMMENT_LENGTH)
  comment?: string;
}

export class AddTextVisitNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.notes)
  textContent?: string;
}

/**
 * The two upload registrations are twins, and stay two classes rather than one
 * shared shape plus a `checksum`: the caps behind them differ (50 MB of audio,
 * 10 MB of photo) even though neither cap is declared here, and a single class
 * would suggest one contract where there are two.
 *
 * Neither declares its size cap, and that is the point of Q3 in the design
 * note. `sizeBytes` became **mandatory** with item 3.2 — the presigned PUT
 * signs it as Content-Length, so a registration without one cannot be signed —
 * and `normalizeAudioSizeBytes`/`normalizePhotoSizeBytes` already answer
 * "Audio size must be a positive integer up to 50 MB." A DTO `@Max` would
 * replace that, for the one case a real user actually hits (a recording that
 * came out too long), with class-validator's "sizeBytes must not be greater
 * than 52428800". So the DTO takes the *type* and the service keeps the
 * arithmetic.
 *
 * The type is number-or-string for the same reason `latitude` is in
 * locations.dto.ts: both normalizers `Number()` a string, and narrowing to
 * numbers alone would make the presigned PUT unsignable for a client that
 * sends `"1048576"`.
 */
export class RegisterAudioUploadDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_UPLOAD_FILE_NAME_LENGTH)
  fileName?: string;

  // Not an enum, though a supported-types set exists: an unsupported or absent
  // contentType is not an error, it falls back to the file extension
  // (normalizeAudioContentTypeFromFileName). A browser that reports
  // `application/octet-stream` for a .m4a recording is the case that keeps
  // working because of it.
  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @ValidateIf((_dto, value) => typeof value !== "string")
  @IsNumber()
  sizeBytes?: number | string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.code)
  checksum?: string;
}

export class RegisterProblemPhotoDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_UPLOAD_FILE_NAME_LENGTH)
  fileName?: string;

  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @ValidateIf((_dto, value) => typeof value !== "string")
  @IsNumber()
  sizeBytes?: number | string;
}
