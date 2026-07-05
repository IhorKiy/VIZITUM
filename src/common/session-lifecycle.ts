import { randomBytes } from "node:crypto";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type IssuedSessionToken = {
  token: string;
  expiresAt: Date;
};

// Single source of truth for session token size/TTL policy so a future change
// (rotate token length, shorten TTL) only needs one edit, shared by every
// session table (tenant sessions, platform sessions, ...).
export function issueSessionToken(
  tokenBytes: number,
  ttlDays: number,
): IssuedSessionToken {
  return {
    token: randomBytes(tokenBytes).toString("base64url"),
    expiresAt: new Date(Date.now() + ttlDays * MILLISECONDS_PER_DAY),
  };
}

export function isSessionActive(session: {
  revokedAt: Date | null;
  expiresAt: Date;
}): boolean {
  return !session.revokedAt && session.expiresAt > new Date();
}
