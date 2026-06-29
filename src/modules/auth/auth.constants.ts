export const SESSION_COOKIE_NAME = "vizitum_session";
export const CSRF_COOKIE_NAME = "vizitum_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const SESSION_TTL_DAYS = 30;
export const SESSION_TOKEN_BYTES = 32;
export const CSRF_TOKEN_BYTES = 24;
export const HASH_ALGORITHM = "sha256";

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
