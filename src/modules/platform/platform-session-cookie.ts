import type { Request, Response } from "express";

import {
  COOKIE_OPTIONS,
  SESSION_TTL_DAYS,
} from "../auth/auth.constants";
import { PLATFORM_SESSION_COOKIE_NAME } from "./platform-auth.constants";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function readPlatformSessionToken(request: Request): string | null {
  const cookieHeader = request.header("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookie.split("=");
    const name = rawName?.trim();

    if (name !== PLATFORM_SESSION_COOKIE_NAME) {
      continue;
    }

    const rawValue = rawValueParts.join("=").trim();

    return rawValue ? decodeURIComponent(rawValue) : null;
  }

  return null;
}

export function writePlatformSessionCookie(
  response: Response,
  token: string,
): void {
  response.cookie(PLATFORM_SESSION_COOKIE_NAME, token, {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_TTL_DAYS * MILLISECONDS_PER_DAY,
  });
}

export function clearPlatformSessionCookie(response: Response): void {
  response.clearCookie(PLATFORM_SESSION_COOKIE_NAME, COOKIE_OPTIONS);
}
