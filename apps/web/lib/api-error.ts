/**
 * The API's error `code` turned into a translated message key.
 *
 * 25 sites across `admin/*`, `field/*`, `manager/*` and `operations` render
 * `someResult.message` verbatim — the backend's English — directly beneath a
 * next-intl-translated heading, so a Ukrainian tenant reads "Authentication is
 * required." under a Ukrainian title. `web:i18n:check` cannot catch it: that
 * script scans for Cyrillic *literals*, and these are English values arriving
 * at runtime (audit F14).
 *
 * The shape is `lib/login-error.ts`'s, which solved the same problem for the
 * sign-in screen: map a known code to a key, collapse everything else onto one
 * fallback. Two properties follow, and both are the point:
 *
 *   - **no backend text ever reaches the screen.** A code the map does not
 *     know renders the fallback, not the English sentence — otherwise the
 *     untranslated case survives exactly where nobody looked.
 *   - **an unknown code is not an error.** New codes appear on the backend all
 *     the time; the frontend degrading to "something went wrong" is correct
 *     behaviour, not a gap to be linted.
 *
 * This is also why audit F21 needs the *code* rather than a translated
 * message: that screen carries a failure across a redirect, and a code is inert
 * in a URL where reflected text is not.
 *
 * Add codes here as the remaining sites convert. The map is deliberately one
 * table rather than a per-screen one — the same code means the same thing
 * wherever it is answered, and a second table is how two screens start
 * disagreeing about what `MISSING_PERMISSION` means.
 */
export type ApiErrorMessageKey =
  | "authenticationRequired"
  | "permissionDenied"
  | "workspaceUnavailable"
  | "sessionExpired"
  | "visitNotActive"
  | "reportInvalid"
  | "photoInvalid"
  | "unknown";

const MESSAGE_KEY_BY_CODE: Record<string, ApiErrorMessageKey> = {
  AUTHENTICATION_REQUIRED: "authenticationRequired",
  MISSING_PERMISSION: "permissionDenied",
  // The workspace itself is refusing to serve, before anything the caller did
  // was even looked at — the distinction login-error.ts exists to preserve.
  TENANT_NOT_READY: "workspaceUnavailable",
  TENANT_UNAVAILABLE: "workspaceUnavailable",
  TENANT_ARCHIVED: "workspaceUnavailable",
  // A CSRF refusal is not something a reader can act on as such; what it means
  // to them is that this tab has gone stale and signing in again fixes it.
  CSRF_TOKEN_INVALID: "sessionExpired",
  CSRF_TOKEN_MALFORMED: "sessionExpired",
  CSRF_TOKEN_REQUIRED: "sessionExpired",
  // The field report's own refusals, which are the ones a rep standing in a
  // shop can actually do something about.
  VISIT_NOT_ACTIVE: "visitNotActive",
  REPORT_INVALID: "reportInvalid",
  PHOTO_UPLOAD_INVALID: "photoInvalid",
};

export function apiErrorMessageKey(
  code: string | undefined,
): ApiErrorMessageKey {
  return (code && MESSAGE_KEY_BY_CODE[code]) || "unknown";
}
