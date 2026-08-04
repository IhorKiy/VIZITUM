import "reflect-metadata";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

import { TEXT_LIMITS } from "../../common/input-limits";

// parseOptionalDateOnly treats an empty string as "no due date", the same as
// null, so the pattern has to admit it — the field app's date input posts ""
// when a rep clears the day. Narrowing that to a 400 would turn clearing a
// due date into an error, which is a contract change no finding asked for.
const OPTIONAL_DATE_ONLY_PATTERN = /^(\d{4}-\d{2}-\d{2})?$/;

/**
 * Flat-CRUD tier of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md), scoped to TasksController's two write
 * routes via createStrictValidationPipe().
 *
 * The four id fields carry no MaxLength on purpose. Every cap in this tier
 * mirrors one the service already enforces; there is no cap on an id anywhere
 * today, and inventing one here would be a limit with no finding behind it
 * and a new way to break if the id format ever grows. `@IsString()` is the
 * gate — the value is looked up against the tenant's own rows immediately
 * after, which is the check that actually matters.
 */
export class CreateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.title)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.notes)
  description?: string;

  // Tightening: normalizeIsPriority is `value === true`, so a caller sending
  // the string "true" silently created a non-priority task.
  @IsOptional()
  @IsBoolean()
  isPriority?: boolean;

  @IsOptional()
  @IsString()
  assignedToUserId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  visitId?: string;

  @IsOptional()
  @IsString()
  reportId?: string;

  @IsOptional()
  @Matches(OPTIONAL_DATE_ONLY_PATTERN, {
    message: "dueDate must be in YYYY-MM-DD format.",
  })
  dueDate?: string;
}

export class UpdateTaskDto extends CreateTaskDto {
  // The sharpest of this tier's tightenings. parseUpdateTaskBody reads
  // `normalizeTaskStatus(body.status) ?? "in_progress"`, so a status the
  // service did not recognise did not fall through to "no change" — it
  // reopened a completed task. That is a wrong write answered with a 200.
  @IsOptional()
  @IsIn(["in_progress", "done"])
  status?: string;

  // Deliberately only a string. parseOptionalDateTime accepts anything
  // `new Date()` can read and answers `DATETIME_INVALID` for the rest, so
  // pinning an ISO shape here would narrow a contract the service defines
  // more loosely — and it is the service's rejection the client already
  // handles.
  @IsOptional()
  @IsString()
  completedAt?: string;
}
