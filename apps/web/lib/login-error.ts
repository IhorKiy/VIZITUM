/**
 * The two mappings behind a failed sign-in: the API error code becomes the
 * `?error=` reason the login page redirects to, and that reason becomes the
 * `auth.*` message it renders.
 *
 * Every failure used to collapse into `invalid` — "Invalid email or password" —
 * which made a refusal of the *workspace* read as a typo in the password.
 * `TENANT_NOT_READY` and `TENANT_UNAVAILABLE` come from
 * `TenancyService.assertTenantCanServeRequests` (`src/modules/tenancy`) and are
 * thrown before the password is looked at at all: the workspace is not serving
 * requests, and no password will open it. A staging tenant left on a legacy
 * status after a migration cost a real debugging session for exactly this
 * reason — every attempt was reported back as bad credentials.
 *
 * Genuine credential failures keep collapsing, deliberately: `INVALID_CREDENTIALS`
 * is the single answer for both "no such user" and "wrong password", so the form
 * never becomes a membership oracle for a tenant. Anything unrecognized joins
 * them rather than growing a new way to tell accounts apart.
 */
export type LoginErrorReason = "network" | "captcha" | "workspace" | "invalid";

type LoginErrorMessageKey =
  | "errorNetwork"
  | "errorCaptcha"
  | "errorWorkspaceUnavailable"
  | "errorInvalid";

export function loginErrorReason(code: string | undefined): LoginErrorReason {
  switch (code) {
    case "CAPTCHA_INVALID":
      return "captcha";
    case "TENANT_NOT_READY":
    case "TENANT_UNAVAILABLE":
      return "workspace";
    default:
      return "invalid";
  }
}

/**
 * `reason` arrives off the query string, so it is whatever the URL carried —
 * an unknown value falls through to the credential message rather than
 * rendering nothing.
 */
export function loginErrorMessageKey(
  reason: string | undefined,
): LoginErrorMessageKey {
  switch (reason) {
    case "network":
      return "errorNetwork";
    case "captcha":
      return "errorCaptcha";
    case "workspace":
      return "errorWorkspaceUnavailable";
    default:
      return "errorInvalid";
  }
}
