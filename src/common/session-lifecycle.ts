import { randomBytes } from "node:crypto";

import { MILLISECONDS_PER_DAY } from "./time";

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

export type SessionUpdateDelegate = {
  update(args: {
    where: { id: string };
    data: { lastSeenAt: Date };
  }): Promise<unknown>;
};

// Shared so every caller that marks a session as recently active — tenant
// sessions, platform sessions, and the guard's own direct queries — stays in
// sync with a single lastSeenAt policy.
export async function touchSession(
  delegate: SessionUpdateDelegate,
  sessionId: string,
): Promise<void> {
  await delegate.update({
    where: { id: sessionId },
    data: { lastSeenAt: new Date() },
  });
}
