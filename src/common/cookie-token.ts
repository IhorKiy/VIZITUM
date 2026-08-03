import { parse } from "cookie";
import type { CookieOptions, Request, Response } from "express";

import { MILLISECONDS_PER_DAY } from "./time";

export function readCookieToken(
  request: Request,
  cookieName: string,
): string | null {
  const cookieHeader = request.header("cookie");

  if (!cookieHeader) {
    return null;
  }

  // parse() decodes each value and falls back to the raw string if decoding
  // fails, rather than throwing — the hand-rolled version this replaced
  // called decodeURIComponent directly, so a malformed percent-encoded
  // cookie (a stray "%", say) threw out of what every session/CSRF read goes
  // through.
  const value = parse(cookieHeader)[cookieName];

  return value ? value : null;
}

export function writeCookieToken(
  response: Response,
  cookieName: string,
  token: string,
  cookieOptions: CookieOptions,
  ttlDays: number,
): void {
  response.cookie(cookieName, token, {
    ...cookieOptions,
    maxAge: ttlDays * MILLISECONDS_PER_DAY,
  });
}

export function clearCookieToken(
  response: Response,
  cookieName: string,
  cookieOptions: CookieOptions,
): void {
  response.clearCookie(cookieName, cookieOptions);
}
