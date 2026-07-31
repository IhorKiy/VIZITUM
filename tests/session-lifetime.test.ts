import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSessionActive,
  issueSessionToken,
  issueSessionTokenForHours,
} from "../src/common/session-lifecycle";
import {
  SESSION_IDLE_TIMEOUT_HOURS,
  SESSION_TTL_DAYS,
} from "../src/modules/auth/auth.constants";
import {
  PLATFORM_SESSION_IDLE_TIMEOUT_HOURS,
  PLATFORM_SESSION_TTL_HOURS,
} from "../src/modules/platform/platform-auth.constants";

const HOUR_MS = 60 * 60 * 1_000;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * HOUR_MS);
}

function hoursAhead(hours: number): Date {
  return new Date(Date.now() + hours * HOUR_MS);
}

describe("session expiry", () => {
  it("accepts a live session that is inside both deadlines", () => {
    assert.equal(
      isSessionActive(
        {
          revokedAt: null,
          expiresAt: hoursAhead(24),
          lastSeenAt: hoursAgo(1),
        },
        SESSION_IDLE_TIMEOUT_HOURS,
      ),
      true,
    );
  });

  it("rejects a revoked session", () => {
    assert.equal(
      isSessionActive(
        {
          revokedAt: new Date(),
          expiresAt: hoursAhead(24),
          lastSeenAt: hoursAgo(1),
        },
        SESSION_IDLE_TIMEOUT_HOURS,
      ),
      false,
    );
  });

  it("rejects a session past its absolute expiry however recently it was used", () => {
    assert.equal(
      isSessionActive(
        {
          revokedAt: null,
          expiresAt: hoursAgo(1),
          lastSeenAt: new Date(),
        },
        SESSION_IDLE_TIMEOUT_HOURS,
      ),
      false,
    );
  });

  it("rejects a session idle past the timeout, even inside its absolute TTL", () => {
    // The regression this closes: lastSeenAt was written on every
    // authenticated request and never read, so a session abandoned on a lost
    // phone stayed usable for the whole absolute TTL.
    assert.equal(
      isSessionActive(
        {
          revokedAt: null,
          expiresAt: hoursAhead(24),
          lastSeenAt: hoursAgo(SESSION_IDLE_TIMEOUT_HOURS + 1),
        },
        SESSION_IDLE_TIMEOUT_HOURS,
      ),
      false,
    );
  });

  it("keeps a session alive across a normal weekend", () => {
    // Friday evening to Monday morning is about 64 hours. Logging every rep
    // out over a weekend would be a self-inflicted outage every Monday.
    assert.equal(
      isSessionActive(
        {
          revokedAt: null,
          expiresAt: hoursAhead(24),
          lastSeenAt: hoursAgo(64),
        },
        SESSION_IDLE_TIMEOUT_HOURS,
      ),
      true,
    );
  });

  it("treats a session that has never been seen as live", () => {
    // lastSeenAt is written on the first authenticated request after login,
    // so a brand-new session has none; the absolute TTL still bounds it.
    assert.equal(
      isSessionActive(
        { revokedAt: null, expiresAt: hoursAhead(24), lastSeenAt: null },
        SESSION_IDLE_TIMEOUT_HOURS,
      ),
      true,
    );
  });

  it("applies no idle deadline when none is given", () => {
    assert.equal(
      isSessionActive({
        revokedAt: null,
        expiresAt: hoursAhead(24),
        lastSeenAt: hoursAgo(10_000),
      }),
      true,
    );
  });

  it("holds the platform session to a much tighter idle deadline", () => {
    const idleForThreeHours = {
      revokedAt: null,
      expiresAt: hoursAhead(6),
      lastSeenAt: hoursAgo(3),
    };

    // The same three-hour gap is nothing for a rep mid-round and is an
    // abandoned console for the platform owner.
    assert.equal(
      isSessionActive(idleForThreeHours, SESSION_IDLE_TIMEOUT_HOURS),
      true,
    );
    assert.equal(
      isSessionActive(idleForThreeHours, PLATFORM_SESSION_IDLE_TIMEOUT_HOURS),
      false,
    );
  });
});

describe("session lifetime policy", () => {
  it("keeps the tenant session well under the month it used to last", () => {
    assert.ok(SESSION_TTL_DAYS <= 7);
    assert.ok(SESSION_IDLE_TIMEOUT_HOURS < SESSION_TTL_DAYS * 24);
  });

  it("measures the platform session in hours, not days", () => {
    // One account reaches every tenant's data, and nothing about the console
    // is a daily working tool.
    assert.ok(PLATFORM_SESSION_TTL_HOURS <= 24);
    assert.ok(
      PLATFORM_SESSION_IDLE_TIMEOUT_HOURS < PLATFORM_SESSION_TTL_HOURS,
    );
  });

  it("issues tokens with the expiry the caller asked for", () => {
    const days = issueSessionToken(32, SESSION_TTL_DAYS);
    const hours = issueSessionTokenForHours(32, PLATFORM_SESSION_TTL_HOURS);

    assert.ok(
      Math.abs(
        days.expiresAt.getTime() - Date.now() - SESSION_TTL_DAYS * 24 * HOUR_MS,
      ) < 5_000,
    );
    assert.ok(
      Math.abs(
        hours.expiresAt.getTime() -
          Date.now() -
          PLATFORM_SESSION_TTL_HOURS * HOUR_MS,
      ) < 5_000,
    );
    assert.notEqual(days.token, hours.token);
  });
});
