import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NestMiddleware,
} from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_OPTIONS,
  CSRF_HEADER_NAME,
  CSRF_TOKEN_BYTES,
  HASH_ALGORITHM,
  SESSION_TTL_DAYS,
} from "./auth.constants";
import { readPlatformSessionToken } from "../platform/platform-session-cookie";
import { readSessionToken } from "./session-cookie";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createCsrfToken(sessionToken: string): string {
  const nonce = randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
  const signature = signCsrfNonce(sessionToken, nonce);

  return `${nonce}.${signature}`;
}

export function writeCsrfCookie(response: Response, csrfToken: string): void {
  response.cookie(CSRF_COOKIE_NAME, csrfToken, {
    ...CSRF_COOKIE_OPTIONS,
    maxAge: SESSION_TTL_DAYS * MILLISECONDS_PER_DAY,
  });
}

export function clearCsrfCookie(response: Response): void {
  response.clearCookie(CSRF_COOKIE_NAME, CSRF_COOKIE_OPTIONS);
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

  const sessionToken =
    readSessionToken(request) ?? readPlatformSessionToken(request);

  if (!sessionToken) {
    next();
    return;
  }

  const headerToken = request.header(CSRF_HEADER_NAME);
  const cookieToken = readCookie(request, CSRF_COOKIE_NAME);

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    throw new ForbiddenException({
      code: "CSRF_TOKEN_REQUIRED",
      message: "A valid CSRF token is required.",
    });
  }

  if (!verifyCsrfToken(sessionToken, headerToken)) {
    throw new ForbiddenException({
      code: "CSRF_TOKEN_INVALID",
      message: "A valid CSRF token is required.",
    });
  }

  next();
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

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.header("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookie.split("=");

    if (rawName?.trim() !== name) {
      continue;
    }

    const rawValue = rawValueParts.join("=").trim();

    return rawValue ? decodeURIComponent(rawValue) : null;
  }

  return null;
}
