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

// Logout intentionally skips CSRF. A forged cross-site logout can only ever
// end the *caller's own* session — the token it acts on comes from that
// browser's httpOnly session cookie, never one an attacker can choose — so
// the worst case is an unwanted logout, not data exposure or privilege
// escalation (the commonly-accepted "logout CSRF" trade-off). Requiring a
// token here instead has a real cost with no offsetting benefit: the
// readable, independently-stored CSRF cookie can go stale or missing while
// the httpOnly session cookie is still valid, which blocks the session from
// ever being revoked server-side until its 30-day TTL lapses — including
// for a stolen token, which is exactly the case logout-revocation exists to
// guard against. Both the `/api`-prefixed and bare forms are listed to
// match the tolerance already used below for platform-path detection.
const CSRF_EXEMPT_ROUTES = new Set([
  "/api/auth/logout",
  "/auth/logout",
  "/api/platform/auth/logout",
  "/platform/auth/logout",
]);

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

  // Normalized once and shared by both checks below. They used to derive the
  // path independently — the exemption list lowercased, the platform-session
  // lookup did not — so `POST /api/Platform/...` reached the platform handler
  // (Express routing was case-insensitive) while resolveCsrfSession failed to
  // recognise it as a platform path, found no session, and skipped CSRF.
  const requestPath = normalizeRequestPath(request);

  if (isCsrfExemptRoute(request.method, requestPath)) {
    next();
    return;
  }

  const resolved = resolveCsrfSession(request, requestPath);

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

// Single normalization for every path decision in this file: query dropped,
// lowercased, trailing slashes trimmed. The bootstrap now also turns on
// case-sensitive and strict Express routing, so those spellings 404 before
// they get here — but this must not depend on that. The flags are read once
// when Express builds its router and are silently ignored if set a moment too
// late, which is precisely how the mixed-case bypass came about.
export function normalizeRequestPath(request: Request): string {
  const rawPath = request.originalUrl ?? request.url ?? "";

  return rawPath.split("?")[0].toLowerCase().replace(/\/+$/, "");
}

function isCsrfExemptRoute(method: string, requestPath: string): boolean {
  if (method !== "POST") {
    return false;
  }

  return CSRF_EXEMPT_ROUTES.has(requestPath);
}

// Takes an already-normalized path. Both the `/api`-prefixed and bare forms
// are matched for the same reason the exemption list carries both: the global
// prefix is applied by Nest, and this middleware also runs in contexts that
// see the unprefixed path.
export function isPlatformPath(requestPath: string): boolean {
  return (
    requestPath === "/api/platform" ||
    requestPath === "/platform" ||
    requestPath.startsWith("/api/platform/") ||
    requestPath.startsWith("/platform/")
  );
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
  requestPath: string,
): { sessionToken: string; cookieName: string } | null {
  if (isPlatformPath(requestPath)) {
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
