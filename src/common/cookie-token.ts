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

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookie.split("=");
    const name = rawName?.trim();

    if (name !== cookieName) {
      continue;
    }

    const rawValue = rawValueParts.join("=").trim();

    return rawValue ? decodeURIComponent(rawValue) : null;
  }

  return null;
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
