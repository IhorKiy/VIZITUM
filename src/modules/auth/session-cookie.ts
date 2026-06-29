import type { Request, Response } from "express";

import {
  COOKIE_OPTIONS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_DAYS,
} from "./auth.constants";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function readSessionToken(request: Request): string | null {
  const cookieHeader = request.header("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookie.split("=");
    const name = rawName?.trim();

    if (name !== SESSION_COOKIE_NAME) {
      continue;
    }

    const rawValue = rawValueParts.join("=").trim();

    return rawValue ? decodeURIComponent(rawValue) : null;
  }

  return null;
}

export function writeSessionCookie(response: Response, token: string): void {
  response.cookie(SESSION_COOKIE_NAME, token, {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_TTL_DAYS * MILLISECONDS_PER_DAY,
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE_NAME, COOKIE_OPTIONS);
}
