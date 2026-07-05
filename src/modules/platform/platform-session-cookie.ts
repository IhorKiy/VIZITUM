import type { Request, Response } from "express";

import {
  clearCookieToken,
  readCookieToken,
  writeCookieToken,
} from "../../common/cookie-token";
import { COOKIE_OPTIONS, SESSION_TTL_DAYS } from "../auth/auth.constants";
import { PLATFORM_SESSION_COOKIE_NAME } from "./platform-auth.constants";

export function readPlatformSessionToken(request: Request): string | null {
  return readCookieToken(request, PLATFORM_SESSION_COOKIE_NAME);
}

export function writePlatformSessionCookie(
  response: Response,
  token: string,
): void {
  writeCookieToken(
    response,
    PLATFORM_SESSION_COOKIE_NAME,
    token,
    COOKIE_OPTIONS,
    SESSION_TTL_DAYS,
  );
}

export function clearPlatformSessionCookie(response: Response): void {
  clearCookieToken(response, PLATFORM_SESSION_COOKIE_NAME, COOKIE_OPTIONS);
}
