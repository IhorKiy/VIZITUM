import "reflect-metadata";
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

import { TEXT_LIMITS } from "../../common/input-limits";
import { INVITABLE_ROLE_CODES, type InvitableRoleCode } from "./users.types";

/**
 * Tier 4 of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md): AdminUsersController's three bodies.
 *
 * Optional throughout — users.service.ts keeps `INVITE_INVALID`,
 * `USER_PHONE_INVALID` and `INVALID_ROLE`, and every required-ness,
 * uniqueness and admin-cap check stays behind this gate.
 */
export class InviteUserDto {
  // normalizeEmail treats anything past TEXT_LIMITS.email as "not an email",
  // so the cap is the same number read one layer earlier.
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.email)
  email?: string | null;

  // The tier's dropped-enum rule, in its quietest form. normalizeRoleCodes
  // filters unrecognised entries out of the array rather than refusing it, so
  // `["field_representative", "company_admn"]` invited someone as a rep alone
  // and answered 200 — the typo'd role simply never existed. A whole array of
  // typos does surface (the empty result trips "at least one valid role is
  // required"), which is exactly why the mixed case slipped through.
  //
  // `tenant_superadmin` is absent from INVITABLE_ROLE_CODES by design: it is
  // the platform owner's to grant, and this route never could.
  @IsOptional()
  @IsArray()
  @IsIn(INVITABLE_ROLE_CODES, { each: true })
  roleCodes?: InvitableRoleCode[] | null;
}

export class UpdateUserDto {
  // normalizeNamePart discards an over-long name, and updateUser then composes
  // no name fields at all — a 200-character first name came back 200 with the
  // old name intact. TEXT_LIMITS.name is the normalizer's own cap.
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  firstName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  lastName?: string | null;

  // Uncapped on purpose, unlike the two names above. updateUser passes an
  // *unchanged* phone through without validating it, so a user whose legacy
  // phone predates normalization stays editable; a MaxLength here would refuse
  // the admin screen's own round-trip of that stored value and strand exactly
  // the rows that fallback exists for. `null` clears the phone.
  @IsOptional()
  @IsString()
  phone?: string | null;

  // The tier's headline case. normalizeUserStatus dropped anything outside the
  // set to `null`, and `status ? { status } : {}` then wrote nothing: a typo'd
  // status returned 200 having left a suspended admin active.
  @IsOptional()
  @IsIn(["active", "suspended", "invited"])
  status?: string | null;
}

export class AddUserRoleDto {
  // Gated on the same vocabulary as the invite, though this route already
  // refuses an unknown code loudly (`INVALID_ROLE`, "A valid role code is
  // required."). Splitting the treatment — enum on one route, free string on
  // the other — would leave the next reader guessing which list is real.
  @IsOptional()
  @IsIn(INVITABLE_ROLE_CODES)
  roleCode?: InvitableRoleCode | null;
}
