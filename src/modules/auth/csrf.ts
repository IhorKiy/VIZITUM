import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NestMiddleware,
} from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { readCookieToken } from "../../common/cookie-token";
import { MILLISECONDS_PER_DAY } from "../../common/time";
import { PLATFORM_CSRF_COOKIE_NAME } from "../platform/platform-auth.constants";
import { readPlatformSessionToken } from "../platform/platform-session-cookie";
import {
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_OPTIONS,
  CSRF_HEADER_NAME,
  CSRF_TOKEN_BYTES,
  HASH_ALGORITHM,
  SESSION_TTL_DAYS,
} from "./auth.constants";
import { readSessionToken } from "./session-cookie";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createCsrfToken(sessionToken: string): string {
  const nonce = randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
  const signature = signCsrfNonce(sessionToken, nonce);

  return `${nonce}.${signature}`;
}

export function writeCsrfCookie(
  response: Response,
  csrfToken: string,
  cookieName: string,
): void {
  response.cookie(cookieName, csrfToken, {
    ...CSRF_COOKIE_OPTIONS,
    maxAge: SESSION_TTL_DAYS * MILLISECONDS_PER_DAY,
  });
}

export function clearCsrfCookie(response: Response, cookieName: string): void {
  response.clearCookie(cookieName, CSRF_COOKIE_OPTIONS);
}

export function applyCsrfProtection(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  if (SAFE_METHODS.has(request.method)) {
    next();
    return;
  }

  const resolved = resolveCsrfSession(request);

  if (!resolved) {
    next();
    return;
  }

  const headerToken = request.header(CSRF_HEADER_NAME);
  const cookieToken = readCookieToken(request, resolved.cookieName);

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    throw new ForbiddenException({
      code: "CSRF_TOKEN_REQUIRED",
      message: "A valid CSRF token is required.",
    });
  }

  if (!verifyCsrfToken(resolved.sessionToken, headerToken)) {
    throw new ForbiddenException({
      code: "CSRF_TOKEN_INVALID",
      message: "A valid CSRF token is required.",
    });
  }

  next();
}

// Platform and tenant sessions each get their own CSRF cookie
// (vizitum_platform_csrf / vizitum_csrf). They used to share one cookie
// name, so authenticating into one domain regenerated the cookie the other
// domain's still-valid session depended on, CSRF-locking it out with
// correct credentials.
//
// There is deliberately no cross-domain fallback: a platform path is only
// ever checked against the platform session/cookie pair, a tenant path only
// against the tenant pair. If the matching session is absent, CSRF is
// skipped here (same as when no session at all is present) and the request
// falls through to PermissionGuard, which requires that domain's session
// and rejects it with 401/403 regardless of what CSRF decided.
function resolveCsrfSession(
  request: Request,
): { sessionToken: string; cookieName: string } | null {
  const requestPath = request.originalUrl ?? request.url ?? "";
  const isPlatformPath =
    requestPath.startsWith("/api/platform/") ||
    requestPath === "/api/platform" ||
    requestPath.startsWith("/platform/") ||
    requestPath === "/platform";

  if (isPlatformPath) {
    const platformSessionToken = readPlatformSessionToken(request);

    return platformSessionToken
      ? {
          sessionToken: platformSessionToken,
          cookieName: PLATFORM_CSRF_COOKIE_NAME,
        }
      : null;
  }

  const tenantSessionToken = readSessionToken(request);

  return tenantSessionToken
    ? { sessionToken: tenantSessionToken, cookieName: CSRF_COOKIE_NAME }
    : null;
}

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction) {
    applyCsrfProtection(request, response, next);
  }
}

function verifyCsrfToken(sessionToken: string, csrfToken: string): boolean {
  const [nonce, signature] = csrfToken.split(".");

  if (!nonce || !signature) {
    throw new BadRequestException({
      code: "CSRF_TOKEN_MALFORMED",
      message: "CSRF token is malformed.",
    });
  }

  const expectedSignature = signCsrfNonce(sessionToken, nonce);

  return safeEqual(signature, expectedSignature);
}

function signCsrfNonce(sessionToken: string, nonce: string): string {
  return createHmac(HASH_ALGORITHM, sessionToken).update(nonce).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
