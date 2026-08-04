import "reflect-metadata";
import { IsOptional, IsString } from "class-validator";

/**
 * Tier 6: `PasswordController`'s three bodies. The rule and its three reasons
 * are at the top of auth.dto.ts; this file is where the second of them —
 * *deliberately non-enumerating* — does the most work.
 *
 * Every field here is `@IsString()` and nothing more. In particular there is
 * no `@MinLength(MIN_PASSWORD_LENGTH)` on any new password, though the two
 * normalizers enforce exactly that: `PASSWORD_RESET_INVALID` and
 * `PASSWORD_CHANGE_INVALID` answer with `fieldErrors.password` = "Password
 * must be at least 8 characters.", interpolated from the constant. That is the
 * message a person retyping a password needs, and it is the message a
 * whitelist rejection would replace.
 */
export class ForgotPasswordDto {
  /**
   * `requestReset` answers 200 `acknowledge()` to everything — an unknown
   * address, an inactive account, a tenant that does not resolve, its own
   * per-IP bucket running dry. That uniformity is the whole design of the
   * endpoint: it must not become a way to ask whether an address has an
   * account here.
   *
   * `@IsString()` does not weaken it. It separates a malformed body from a
   * well-formed one, which says nothing about any account — the property being
   * protected is that two *addresses* are indistinguishable, and they still
   * are. What would weaken it is a cap or a format check, since "this address
   * is too long to exist" and "no email was sent" are different answers to a
   * caller probing with generated addresses.
   */
  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @IsString()
  tenantSlug?: string | null;

  // `""` when the deployment has no captcha configured, as on the login form.
  @IsOptional()
  @IsString()
  captchaToken?: string | null;
}

export class ResetPasswordDto {
  // A single-use secret, uncapped here: normalizeToken bounds it at
  // TEXT_LIMITS.token and answers PASSWORD_RESET_INVALID, which is also the
  // answer to a token that is well-formed but wrong or expired — one answer to
  // every unusable token, which is what this endpoint wants.
  @IsOptional()
  @IsString()
  token?: string | null;

  @IsOptional()
  @IsString()
  tenantSlug?: string | null;

  @IsOptional()
  @IsString()
  password?: string | null;
}

export class ChangePasswordDto {
  // `normalizeCurrentPassword` deliberately applies no minimum — the stored
  // password predates whatever the current rule is, and the only question
  // asked of it is whether it verifies. A `@MinLength` here would lock out
  // exactly the accounts that comment exists for.
  @IsOptional()
  @IsString()
  currentPassword?: string | null;

  @IsOptional()
  @IsString()
  newPassword?: string | null;
}
