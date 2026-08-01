import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

import { hashValue } from "./auth-crypto";

/**
 * The platform operations bearer token.
 *
 * Extracted from PermissionGuard so a route that is *not* guarded can still
 * ask "is this an operator?" — readiness is the case: it has to stay
 * anonymous for uptime monitors, while the parts of its answer that would
 * tell an anonymous caller something about the deployment's internals are
 * shown only to a holder of this token.
 *
 * Scope is deliberately narrow: this token grants `platform.operations.read`
 * and nothing else. Managing tenants needs a real platform_owner session.
 */
export function readBearerToken(request: Request): string | null {
  const authorization = request.header("authorization")?.trim();

  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authorization.slice("bearer ".length).trim();

  return token || null;
}

export function isValidPlatformOperationsToken(token: string): boolean {
  const expectedHash = process.env.PLATFORM_OPERATIONS_TOKEN_SHA256?.trim();
  const tokenHash = hashValue(token);

  if (expectedHash) {
    return secureHashEquals(tokenHash, expectedHash);
  }

  const expectedToken = process.env.PLATFORM_OPERATIONS_TOKEN?.trim();

  if (!expectedToken) {
    return false;
  }

  return secureHashEquals(tokenHash, hashValue(expectedToken));
}

/** True when the request carries a valid operations bearer token. */
export function hasPlatformOperationsToken(request: Request): boolean {
  const token = readBearerToken(request);

  return Boolean(token && isValidPlatformOperationsToken(token));
}

function secureHashEquals(actualHash: string, expectedHash: string): boolean {
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
