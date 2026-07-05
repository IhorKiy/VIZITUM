import type { Request, Response } from "express";

import {
  clearCookieToken,
  readCookieToken,
  writeCookieToken,
} from "../../common/cookie-token";
import {
  COOKIE_OPTIONS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_DAYS,
} from "./auth.constants";

export function readSessionToken(request: Request): string | null {
  return readCookieToken(request, SESSION_COOKIE_NAME);
}

export function writeSessionCookie(response: Response, token: string): void {
  writeCookieToken(
    response,
    SESSION_COOKIE_NAME,
    token,
    COOKIE_OPTIONS,
    SESSION_TTL_DAYS,
  );
}

export function clearSessionCookie(response: Response): void {
  clearCookieToken(response, SESSION_COOKIE_NAME, COOKIE_OPTIONS);
}
