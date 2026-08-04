import "reflect-metadata";
import { IsOptional, IsString, MaxLength } from "class-validator";

import { TEXT_LIMITS } from "../../common/input-limits";

/**
 * Tier 6 of the class-validator DTO track (2.4 in
 * docs/security-remediation-plan.md), and the last: the credential surfaces.
 * `AuthController`'s four bodies here, `PasswordController`'s three in
 * password.dto.ts, `PlatformAuthController`'s three in
 * platform/platform-auth.dto.ts.
 *
 * **The rule this tier follows, and why it is narrower than every tier before
 * it.** On these ten routes the DTO declares the envelope — which properties
 * may exist — and the type of each, and it makes no other judgement. No
 * length caps on a password, no format on a token, no `@IsIn` on a role. Three
 * reasons, and each applies to a different route:
 *
 * 1. *The refusals are deliberately uniform.* `INVALID_CREDENTIALS` answers
 *    "Invalid email or password." to a missing account, an inactive one and a
 *    wrong password alike — item 3.1 went as far as running a dummy argon2
 *    verify so the three cannot even be told apart by timing. A DTO that
 *    refused an over-long password with its own message would be a second
 *    kind of answer on the one screen in this product that has spent the most
 *    effort having only one.
 * 2. *The refusals are deliberately non-enumerating.* `POST
 *    /auth/password/forgot` acknowledges everything (see password.dto.ts).
 * 3. *The refusals are recorded.* This is the decisive one and it is why
 *    `platform-auth.dto.ts` goes further still, down to `@Allow()`: a pipe
 *    runs before the service, and the service is what charges the per-account
 *    backoff and writes the audit event.
 *
 * What the tier still buys is the thing it was always mainly about: a property
 * no DTO declares is refused by name, on the routes that mint sessions.
 *
 * Worth stating plainly, since it is the question the plan asked this tier to
 * settle: **a body refused here cannot become an unlogged login attempt,
 * because the service already refuses the same class of body before it records
 * anything.** `AuthService.login` normalizes `email`/`password` and throws
 * `INVALID_CREDENTIALS` *before* the captcha check, before the backoff and
 * before `recordTenantLoginFailed` — so a malformed body has never been a
 * recorded attempt, and moving that same refusal one layer earlier changes
 * only the status code. Nest's order (guards, then pipes) also means the
 * per-IP throttle has already charged for the request by the time this class
 * is reached. `tests/auth-dto-validation.test.ts` pins both halves.
 */
export class LoginDto {
  // Note what is *not* here: `@MaxLength(TEXT_LIMITS.email)`. normalizeEmail
  // treats an over-long address as "not an email" and the route answers
  // INVALID_CREDENTIALS, which is the same answer it gives a wrong password —
  // and that sameness is the feature.
  @IsOptional()
  @IsString()
  email?: string | null;

  // Uncapped here for the same reason, though normalizePassword does cap at
  // TEXT_LIMITS.password and says why (argon2 hashes whatever it is given, so
  // an unbounded password is an unbounded amount of work). That cap stays
  // exactly where it is: it already runs before any hashing, so declaring it
  // here would buy no work and cost the uniform answer.
  @IsOptional()
  @IsString()
  password?: string | null;

  @IsOptional()
  @IsString()
  tenantSlug?: string | null;

  // Sent as `""` by every deployment with the captcha disabled — the hidden
  // Turnstile input is empty — so this must accept an empty string.
  // `assertValidToken` keeps deciding what a valid token is, including the
  // fail-closed behaviour item 1.2 specifies.
  @IsOptional()
  @IsString()
  captchaToken?: string | null;
}

/**
 * `roleCode` is deliberately not `@IsIn`-gated, which is the opposite of the
 * call `AddUserRoleDto` makes on the same three values.
 *
 * The difference is that there the DTO and the normalizer sat in one module
 * and read one constant. Here they would not: auth.service.ts keeps its own
 * list because "roles a user may operate as" and "roles an admin may grant"
 * are different questions that happen to have the same answer today. Wiring
 * the DTO to the invite vocabulary would encode that coincidence as a
 * dependency. `INVALID_ROLE` stays the service's refusal, and it is a loud one
 * — nothing is silently dropped.
 */
export class SwitchRoleDto {
  @IsOptional()
  @IsString()
  roleCode?: string | null;
}

/** Same reasoning as `SwitchRoleDto`; `isValidZone` owns the set. */
export class SwitchZoneDto {
  @IsOptional()
  @IsString()
  zone?: string | null;
}

/**
 * The one body on this tier carrying fields that are not credentials, and they
 * are treated as tier 2 would treat them.
 *
 * `firstName`/`lastName` are ordinary profile text: normalizeNamePart folds an
 * over-long value into the same null as a missing one, so a 200-character
 * first name came back "First name is required." — the caps-moved-earlier
 * correction this track has made in every tier, on the same `TEXT_LIMITS.name`
 * the normalizer reads. `token` and `password` get no such treatment, for the
 * reasons at the top of this file: the invite token is a single-use secret,
 * and `INVITE_ACCEPTANCE_INVALID` already names the password minimum in its
 * own field error.
 */
export class AcceptInviteDto {
  @IsOptional()
  @IsString()
  token?: string | null;

  @IsOptional()
  @IsString()
  tenantSlug?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  firstName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  lastName?: string | null;

  @IsOptional()
  @IsString()
  password?: string | null;

  // Uncapped, like every other phone on the track: normalizePhoneInput bounds
  // a valid number far tighter than any length could, and the field is
  // optional on this form.
  @IsOptional()
  @IsString()
  phone?: string | null;
}
