import { randomBytes } from "node:crypto";

import { MILLISECONDS_PER_DAY } from "./time";

const MILLISECONDS_PER_HOUR = 60 * 60 * 1_000;

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

export function issueSessionTokenForHours(
  tokenBytes: number,
  ttlHours: number,
): IssuedSessionToken {
  return {
    token: randomBytes(tokenBytes).toString("base64url"),
    expiresAt: new Date(Date.now() + ttlHours * MILLISECONDS_PER_HOUR),
  };
}

export type SessionActivityState = {
  revokedAt: Date | null;
  expiresAt: Date;
  lastSeenAt?: Date | null;
};

/**
 * Two independent deadlines, and a session has to satisfy both.
 *
 * `expiresAt` is absolute: however busy the session is, it ends. `lastSeenAt`
 * is the idle one — it was written on every authenticated request but never
 * read, so a session abandoned on a shared or lost device stayed usable for
 * the whole absolute TTL. Reading it here is what makes a stolen cookie stop
 * working once the theft stops being active use.
 *
 * A session with no `lastSeenAt` yet has only just been created (it is
 * written on the first authenticated request after login), so `createdAt` is
 * not needed as a fallback — the absolute TTL still covers it.
 */
export function isSessionActive(
  session: SessionActivityState,
  idleTimeoutHours?: number,
): boolean {
  const now = new Date();

  if (session.revokedAt || session.expiresAt <= now) {
    return false;
  }

  if (idleTimeoutHours === undefined || !session.lastSeenAt) {
    return true;
  }

  const idleDeadline = new Date(
    session.lastSeenAt.getTime() + idleTimeoutHours * MILLISECONDS_PER_HOUR,
  );

  return idleDeadline > now;
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
